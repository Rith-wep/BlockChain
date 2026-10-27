import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createPublicClient, createWalletClient, formatUnits, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { CONDITION_RECORD_DIRECTORY, loadConditionRecord } from "./lib/condition-inspector.js";
import { loadLocalEnv } from "./lib/load-local-env.js";
import { INTEGRATION_ADDRESSES, loadIntegrationArtifacts, loadRpcUrl } from "./lib/sepolia-integration-preflight.js";
import { SPLIT_QUESTION_ID, SPLIT_WALLET } from "./lib/sepolia-binary-split.js";
import { REDEEM_CONFIRMATION, parseRedemptionMode, runBinaryRedemption, type RedemptionReader, type RedemptionResult } from "./lib/sepolia-binary-redemption.js";

async function main(): Promise<void> {
  const mode = parseRedemptionMode(process.argv.slice(2));
  const record = await loadConditionRecord(resolve(process.cwd(), CONDITION_RECORD_DIRECTORY, `${SPLIT_QUESTION_ID.slice(2)}.json`));
  const artifacts = await loadIntegrationArtifacts();
  const rpcUrl = await loadRpcUrl(process.env.SEPOLIA_RPC_URL);
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const reader: RedemptionReader = {
    getChainId: () => client.getChainId(),
    getCode: (address) => client.getCode({ address }),
    getAdapterCtf: () => client.readContract({ address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "ctf" } as never) as Promise<Address>,
    getAdapterCollateral: () => client.readContract({ address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "collateral" } as never) as Promise<Address>,
    getOfficialConditionId: (oracle, questionId) => client.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "getConditionId", args: [oracle, questionId, 2n] } as never) as Promise<Hex>,
    getOutcomeSlotCount: (conditionId) => client.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "getOutcomeSlotCount", args: [conditionId] } as never) as Promise<bigint>,
    getPayoutDenominator: (conditionId) => client.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "payoutDenominator", args: [conditionId] } as never) as Promise<bigint>,
    getPayoutNumerator: (conditionId, index) => client.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "payoutNumerators", args: [conditionId, index] } as never) as Promise<bigint>,
    getPositionIds: async (oracle, questionId) => {
      const values = await client.readContract({ address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "getBinaryPositionIds", args: [oracle, questionId] } as never) as readonly [Hex, Hex, Hex, bigint, bigint];
      return { conditionId: values[0], yesPositionId: values[3], noPositionId: values[4] };
    },
    getCollateralBalance: (wallet) => client.readContract({ address: INTEGRATION_ADDRESSES.collateral, abi: artifacts.collateral.abi, functionName: "balanceOf", args: [wallet] } as never) as Promise<bigint>,
    getPositionBalance: (wallet, id) => client.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "balanceOf", args: [wallet, id] } as never) as Promise<bigint>,
    getOperatorApproval: (wallet, operator) => client.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "isApprovedForAll", args: [wallet, operator] } as never) as Promise<boolean>,
    simulateRedeem: async (wallet, oracle, questionId) => {
      const { result } = await client.simulateContract({ account: wallet, address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "redeemBinary", args: [oracle, questionId] } as never);
      return result as bigint;
    },
    estimateRedeem: (wallet, oracle, questionId) => client.estimateContractGas({ account: wallet, address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "redeemBinary", args: [oracle, questionId] } as never),
    submitRedeem: async (wallet, oracle, questionId) => {
      // Private key is loaded only after the independent redemption confirmation.
      loadLocalEnv();
      const key = process.env.SEPOLIA_PRIVATE_KEY;
      if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("A valid Sepolia signer is required after confirmation.");
      const account = privateKeyToAccount(key as Hex);
      if (account.address.toLowerCase() !== wallet.toLowerCase()) throw new Error("Signer does not match the expected wallet; no redemption was sent.");
      const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
      return walletClient.writeContract({ account, address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "redeemBinary", args: [oracle, questionId] } as never);
    },
    waitForReceipt: async (hash) => (await client.waitForTransactionReceipt({ hash, confirmations: 2 })).status,
  };
  const print = (result: RedemptionResult) => {
    console.log("Operation: LocalCTFAdapter.redeemBinary(oracle, questionId)");
    console.log("Network: Ethereum Sepolia (chain ID 11155111)");
    console.log(`CTF: ${result.context.ctf}; adapter: ${result.context.adapter}; collateral: ${result.context.collateral}`);
    console.log(`Wallet: ${result.context.wallet}; oracle: ${result.context.oracle}`);
    console.log(`Question ID: ${result.context.questionId}; condition ID: ${result.context.conditionId}`);
    console.log(`Payout [YES, NO]: [${result.context.payoutNumerators.join(", ")}] / ${result.context.payoutDenominator}`);
    console.log(`Positions before: YES ${result.context.yesBalance}; NO ${result.context.noBalance}`);
    console.log(`Expected collateral payout: ${formatUnits(result.expectedPayout, 18)} MOCK (${result.expectedPayout} base units)`);
    console.log(`Estimated gas: ${result.gasEstimate}`);
    console.log("Redemption simulation succeeded. No transaction has been sent.");
  };
  const result = await runBinaryRedemption(SPLIT_WALLET, record, mode === "submit" ? async () => {
    const prompt = createInterface({ input: stdin, output: stdout });
    try { return await prompt.question(`To redeem all eligible positions, type exactly: ${REDEEM_CONFIRMATION}\n> `); }
    finally { prompt.close(); }
  } : undefined, reader, {
    ctfRuntime: artifacts.ctf.runtime, collateralRuntime: artifacts.collateral.runtime,
    adapterRuntime: artifacts.adapter.runtime, adapterImmutableReferences: artifacts.adapter.immutableReferences,
  }, print);
  if (result.submitted) {
    console.log(`Positions after: YES ${result.yesBalanceAfter}; NO ${result.noBalanceAfter}`);
    console.log(`MOCK balance after: ${formatUnits(result.collateralBalanceAfter!, 18)} MOCK`);
    console.log(`Redemption transaction: ${result.transactionHash}`);
    console.log(`Sepolia Etherscan: https://sepolia.etherscan.io/tx/${result.transactionHash}`);
  } else console.log("Read-only redemption preflight complete. Add --submit only after reviewing the simulated payout.");
}
main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : "unknown error";
  const message = error instanceof Error && error.name === "RedemptionError" ? error.message : `provider or command failed (${name}); sensitive details were withheld.`;
  console.error(`Sepolia redemption stopped: ${message}`);
  if (error instanceof Error && "transactionHash" in error && typeof error.transactionHash === "string") console.error(`Transaction: ${error.transactionHash}\nSepolia Etherscan: https://sepolia.etherscan.io/tx/${error.transactionHash}`);
  process.exitCode = 1;
});
