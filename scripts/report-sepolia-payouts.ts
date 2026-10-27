import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { CONDITION_RECORD_DIRECTORY, loadConditionRecord } from "./lib/condition-inspector.js";
import { loadLocalEnv } from "./lib/load-local-env.js";
import { INTEGRATION_ADDRESSES, loadIntegrationArtifacts, loadRpcUrl } from "./lib/sepolia-integration-preflight.js";
import { SPLIT_QUESTION_ID, SPLIT_WALLET } from "./lib/sepolia-binary-split.js";
import { assertPayoutOracleSigner, PAYOUT_CONFIRMATION, parsePayoutMode, runPayoutReport, safePayoutErrorDiagnostic, type PayoutReader, type PayoutResult } from "./lib/sepolia-payout-report.js";

async function main(): Promise<void> {
  const { mode, payouts } = parsePayoutMode(process.argv.slice(2));
  const record = await loadConditionRecord(resolve(process.cwd(), CONDITION_RECORD_DIRECTORY, `${SPLIT_QUESTION_ID.slice(2)}.json`));
  const artifacts = await loadIntegrationArtifacts();
  const rpcUrl = await loadRpcUrl(process.env.SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const reader: PayoutReader = {
    getChainId: () => publicClient.getChainId(),
    getCode: (address) => publicClient.getCode({ address }),
    getAdapterCtf: () => publicClient.readContract({ address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "ctf" } as never) as Promise<Address>,
    getAdapterCollateral: () => publicClient.readContract({ address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "collateral" } as never) as Promise<Address>,
    getOfficialConditionId: (oracle, questionId) => publicClient.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "getConditionId", args: [oracle, questionId, 2n] } as never) as Promise<Hex>,
    getOutcomeSlotCount: (conditionId) => publicClient.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "getOutcomeSlotCount", args: [conditionId] } as never) as Promise<bigint>,
    getPayoutDenominator: (conditionId) => publicClient.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "payoutDenominator", args: [conditionId] } as never) as Promise<bigint>,
    getPayoutNumerator: (conditionId, index) => publicClient.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "payoutNumerators", args: [conditionId, index] } as never) as Promise<bigint>,
    getPositionIds: async (oracle, questionId) => {
      const ids = await publicClient.readContract({ address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "getBinaryPositionIds", args: [oracle, questionId] } as never) as readonly [Hex, Hex, Hex, bigint, bigint];
      return { conditionId: ids[0], yesPositionId: ids[3], noPositionId: ids[4] };
    },
    getCollateralBalance: (wallet) => publicClient.readContract({ address: INTEGRATION_ADDRESSES.collateral, abi: artifacts.collateral.abi, functionName: "balanceOf", args: [wallet] } as never) as Promise<bigint>,
    getPositionBalance: (wallet, id) => publicClient.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "balanceOf", args: [wallet, id] } as never) as Promise<bigint>,
    getOperatorApproval: (wallet, operator) => publicClient.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "isApprovedForAll", args: [wallet, operator] } as never) as Promise<boolean>,
    simulateReport: async (oracle, questionId, vector) => { await publicClient.simulateContract({ account: oracle, address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "reportPayouts", args: [questionId, [...vector]] } as never); },
    estimateReport: (oracle, questionId, vector) => publicClient.estimateContractGas({ account: oracle, address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "reportPayouts", args: [questionId, [...vector]] } as never),
    submitReport: async (oracle, questionId, vector) => {
      // This callback is reached only after the explicit confirmation phrase.
      loadLocalEnv();
      const key = process.env.SEPOLIA_PRIVATE_KEY;
      if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("A valid Sepolia signer is required after confirmation.");
      const account = privateKeyToAccount(key as Hex);
      assertPayoutOracleSigner(account.address, oracle);
      const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
      return wallet.writeContract({ account, address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "reportPayouts", args: [questionId, [...vector]] } as never);
    },
    waitForReceipt: async (hash) => (await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 })).status,
  };
  const onPreflight = (result: PayoutResult) => {
    console.log("Operation: official ConditionalTokens.reportPayouts(questionId, payouts)");
    console.log("Network: Ethereum Sepolia (chain ID 11155111)");
    console.log(`CTF: ${result.context.ctf}; oracle/signer required: ${result.context.oracle}`);
    console.log(`Question ID: ${result.context.questionId}`);
    console.log(`Condition ID: ${result.context.conditionId}`);
    console.log(`Payout vector [YES, NO]: [${payouts[0]}, ${payouts[1]}]`);
    console.log(`Wallet positions: YES ${result.context.yesBalance}; NO ${result.context.noBalance}`);
    console.log(`Estimated gas: ${result.gasEstimate}`);
    console.log("WARNING: payout reporting is irreversible for this condition. Review the outcome and vector carefully.");
    console.log("Simulation succeeded. No transaction has been sent.");
  };
  const result = await runPayoutReport(
    SPLIT_WALLET, record, payouts,
    mode === "submit" ? async () => {
      const prompt = createInterface({ input: stdin, output: stdout });
      try { return await prompt.question(`To irreversibly report payout vector [${payouts[0]}, ${payouts[1]}], type exactly: ${PAYOUT_CONFIRMATION}\n> `); }
      finally { prompt.close(); }
    } : undefined,
    reader,
    { ctfRuntime: artifacts.ctf.runtime, collateralRuntime: artifacts.collateral.runtime, adapterRuntime: artifacts.adapter.runtime, adapterImmutableReferences: artifacts.adapter.immutableReferences },
    onPreflight,
  );
  if (result.submitted) {
    console.log(`Verified payout denominator: ${payouts[0] + payouts[1]}`);
    console.log(`Payout transaction: ${result.transactionHash}`);
    console.log(`Sepolia Etherscan: https://sepolia.etherscan.io/tx/${result.transactionHash}`);
  } else console.log("Read-only payout preflight complete. Add --submit only after reviewing the exact vector and irreversible effect.");
}
main().catch((error: unknown) => {
  const errorName = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name) ? error.name : "unknown error";
  console.error(`Sepolia payout reporting stopped: provider or command failed (${errorName}); sensitive details were withheld.`);
  console.error(`Diagnostic: ${safePayoutErrorDiagnostic(error)}`);
  if (error instanceof Error && "transactionHash" in error && typeof error.transactionHash === "string") console.error(`Transaction: ${error.transactionHash}\nSepolia Etherscan: https://sepolia.etherscan.io/tx/${error.transactionHash}`);
  process.exitCode = 1;
});
