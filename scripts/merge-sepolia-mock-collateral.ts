import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createPublicClient, createWalletClient, formatUnits, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { CONDITION_RECORD_DIRECTORY, loadConditionRecord } from "./lib/condition-inspector.js";
import { loadLocalEnv } from "./lib/load-local-env.js";
import { INTEGRATION_ADDRESSES, loadIntegrationArtifacts, loadRpcUrl } from "./lib/sepolia-integration-preflight.js";
import {
  BinaryMergeError,
  MERGE_CONFIRMATION,
  parseMergeMode,
  runBinaryMerge,
  type BinaryMergeReader,
  type BinaryMergeResult,
} from "./lib/sepolia-binary-merge.js";
import { SPLIT_QUESTION_ID, SPLIT_WALLET } from "./lib/sepolia-binary-split.js";

const RECORD_PATH = resolve(process.cwd(), CONDITION_RECORD_DIRECTORY, `${SPLIT_QUESTION_ID.slice(2)}.json`);

function printPreflight(result: BinaryMergeResult): void {
  const { context } = result;
  console.log("Operation: LocalCTFAdapter.mergeBinary(oracle, questionId, amount)");
  console.log("Network: Ethereum Sepolia (chain ID 11155111)");
  console.log(`CTF: ${context.ctf}`);
  console.log(`MockCollateral: ${context.collateral}`);
  console.log(`LocalCTFAdapter: ${context.adapter}`);
  console.log(`Wallet: ${context.wallet}`);
  console.log(`Oracle: ${context.oracle}`);
  console.log(`Question ID: ${context.questionId}`);
  console.log(`Condition ID: ${context.conditionId}`);
  console.log(`Amount: 1 MOCK (${1_000_000_000_000_000_000n} base units)`);
  console.log(`YES position ID: ${context.yesPositionId}`);
  console.log(`NO position ID: ${context.noPositionId}`);
  console.log(`YES balance before: ${result.yesBalanceBefore}`);
  console.log(`NO balance before: ${result.noBalanceBefore}`);
  console.log(`MOCK balance before: ${formatUnits(result.collateralBalanceBefore, 18)} MOCK`);
  console.log("ERC-1155 operator approval: true");
  console.log(`Estimated gas: ${result.gasEstimate}`);
  console.log("Merge simulation succeeded. No transaction has been sent.");
}

async function main(): Promise<void> {
  const mode = parseMergeMode(process.argv.slice(2));
  const record = await loadConditionRecord(RECORD_PATH);
  const artifacts = await loadIntegrationArtifacts();
  const rpcUrl = await loadRpcUrl(process.env.SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const reader: BinaryMergeReader = {
    getChainId: () => publicClient.getChainId(),
    getCode: (address) => publicClient.getCode({ address }),
    getAdapterCtf: () => publicClient.readContract({ address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "ctf" } as never) as Promise<Address>,
    getAdapterCollateral: () => publicClient.readContract({ address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "collateral" } as never) as Promise<Address>,
    getOfficialConditionId: (oracle, questionId) => publicClient.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "getConditionId", args: [oracle, questionId, 2n] } as never) as Promise<Hex>,
    getOutcomeSlotCount: (conditionId) => publicClient.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "getOutcomeSlotCount", args: [conditionId] } as never) as Promise<bigint>,
    getPayoutDenominator: (conditionId) => publicClient.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "payoutDenominator", args: [conditionId] } as never) as Promise<bigint>,
    getPositionIds: async (oracle, questionId) => {
      const values = await publicClient.readContract({ address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "getBinaryPositionIds", args: [oracle, questionId] } as never) as readonly [Hex, Hex, Hex, bigint, bigint];
      return { conditionId: values[0], yesPositionId: values[3], noPositionId: values[4] };
    },
    getPositionBalance: (wallet, positionId) => publicClient.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "balanceOf", args: [wallet, positionId] } as never) as Promise<bigint>,
    getOperatorApproval: (wallet, operator) => publicClient.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "isApprovedForAll", args: [wallet, operator] } as never) as Promise<boolean>,
    getCollateralBalance: (wallet) => publicClient.readContract({ address: INTEGRATION_ADDRESSES.collateral, abi: artifacts.collateral.abi, functionName: "balanceOf", args: [wallet] } as never) as Promise<bigint>,
    simulateMerge: async (wallet, oracle, questionId, amount) => {
      await publicClient.simulateContract({ account: wallet, address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "mergeBinary", args: [oracle, questionId, amount] } as never);
    },
    estimateMerge: (wallet, oracle, questionId, amount) => publicClient.estimateContractGas({ account: wallet, address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "mergeBinary", args: [oracle, questionId, amount] } as never),
    submitMerge: async (wallet, oracle, questionId, amount) => {
      // This command has an independent confirmation from the operator-approval command.
      loadLocalEnv();
      const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
      if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new BinaryMergeError("A valid SEPOLIA_PRIVATE_KEY is required for confirmed merge.");
      const account = privateKeyToAccount(privateKey as Hex);
      if (account.address.toLowerCase() !== wallet.toLowerCase()) throw new BinaryMergeError("Configured signer does not match the expected wallet; no merge was sent.");
      const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
      return walletClient.writeContract({ account, address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "mergeBinary", args: [oracle, questionId, amount] } as never);
    },
    waitForReceipt: async (hash) => (await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 })).status,
  };

  const result = await runBinaryMerge(
    SPLIT_WALLET,
    record,
    mode === "submit" ? async () => {
      const prompt = createInterface({ input: stdin, output: stdout });
      try { return await prompt.question(`To merge exactly 1 MOCK worth of positions, type exactly: ${MERGE_CONFIRMATION}\n> `); }
      finally { prompt.close(); }
    } : undefined,
    reader,
    {
      ctfRuntime: artifacts.ctf.runtime,
      collateralRuntime: artifacts.collateral.runtime,
      adapterRuntime: artifacts.adapter.runtime,
      adapterImmutableReferences: artifacts.adapter.immutableReferences,
    },
    printPreflight,
  );
  if (!result.submitted) {
    console.log("Read-only merge preflight complete. To request merge, rerun this separate command with --submit and review the fresh checks before confirming.");
    return;
  }
  console.log(`YES balance after: ${result.yesBalanceAfter}`);
  console.log(`NO balance after: ${result.noBalanceAfter}`);
  console.log(`MOCK balance after: ${formatUnits(result.collateralBalanceAfter!, 18)} MOCK`);
  console.log(`Merge transaction: ${result.transactionHash}`);
  console.log(`Sepolia Etherscan: https://sepolia.etherscan.io/tx/${result.transactionHash}`);
}

main().catch((error: unknown) => {
  if (error instanceof BinaryMergeError) {
    console.error(`Sepolia merge stopped: ${error.message}`);
    if (error.transactionHash) console.error(`Transaction: ${error.transactionHash}\nSepolia Etherscan: https://sepolia.etherscan.io/tx/${error.transactionHash}`);
  } else {
    const name = error instanceof Error ? error.name : "unknown error";
    console.error(`Sepolia merge stopped (${name}). Sensitive provider details were withheld.`);
  }
  process.exitCode = 1;
});
