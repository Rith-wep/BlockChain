import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { CONDITION_RECORD_DIRECTORY, loadConditionRecord } from "./lib/condition-inspector.js";
import { loadLocalEnv } from "./lib/load-local-env.js";
import { INTEGRATION_ADDRESSES, loadIntegrationArtifacts, loadRpcUrl } from "./lib/sepolia-integration-preflight.js";
import {
  OPERATOR_APPROVAL_CONFIRMATION,
  OperatorApprovalError,
  parseOperatorApprovalMode,
  runOperatorApproval,
  type OperatorApprovalReader,
  type OperatorApprovalResult,
} from "./lib/sepolia-operator-approval.js";
import { SPLIT_QUESTION_ID, SPLIT_WALLET } from "./lib/sepolia-binary-split.js";

const RECORD_PATH = resolve(process.cwd(), CONDITION_RECORD_DIRECTORY, `${SPLIT_QUESTION_ID.slice(2)}.json`);

function printPreflight(result: OperatorApprovalResult): void {
  const { context } = result;
  console.log("Operation: ConditionalTokens.setApprovalForAll(adapter, true)");
  console.log("Network: Ethereum Sepolia (chain ID 11155111)");
  console.log(`CTF: ${context.ctf}`);
  console.log(`Adapter operator: ${context.adapter}`);
  console.log(`Wallet: ${context.wallet}`);
  console.log(`Question ID: ${context.questionId}`);
  console.log(`Condition ID: ${context.conditionId}`);
  console.log(`YES position ID: ${context.yesPositionId}`);
  console.log(`NO position ID: ${context.noPositionId}`);
  console.log(`Wallet YES balance: ${result.yesBalance}`);
  console.log(`Wallet NO balance: ${result.noBalance}`);
  console.log(`Current operator approval: ${result.alreadyApproved}`);
  if (result.alreadyApproved) {
    console.log("Approval is already enabled; no transaction is needed.");
  } else {
    console.log(`Estimated gas: ${result.gasEstimate}`);
    console.log("Simulation succeeded. No transaction has been sent.");
  }
}

async function main(): Promise<void> {
  const mode = parseOperatorApprovalMode(process.argv.slice(2));
  const record = await loadConditionRecord(RECORD_PATH);
  const artifacts = await loadIntegrationArtifacts();
  const rpcUrl = await loadRpcUrl(process.env.SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  const reader: OperatorApprovalReader = {
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
    simulateApproval: async (wallet, operator, approved) => {
      await publicClient.simulateContract({ account: wallet, address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "setApprovalForAll", args: [operator, approved] } as never);
    },
    estimateApproval: (wallet, operator, approved) => publicClient.estimateContractGas({ account: wallet, address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "setApprovalForAll", args: [operator, approved] } as never),
    submitApproval: async (wallet, operator, approved) => {
      loadLocalEnv();
      const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
      if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new OperatorApprovalError("A valid SEPOLIA_PRIVATE_KEY is required for confirmed operator approval.");
      const account = privateKeyToAccount(privateKey as Hex);
      if (account.address.toLowerCase() !== wallet.toLowerCase()) throw new OperatorApprovalError("Configured signer does not match the expected wallet; no transaction was sent.");
      const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
      return walletClient.writeContract({ account, address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "setApprovalForAll", args: [operator, approved] } as never);
    },
    waitForReceipt: async (hash) => (await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 })).status,
  };

  const result = await runOperatorApproval(
    SPLIT_WALLET,
    record,
    mode === "submit" ? async () => {
      const prompt = createInterface({ input: stdin, output: stdout });
      try { return await prompt.question(`To grant adapter operator access, type exactly: ${OPERATOR_APPROVAL_CONFIRMATION}\n> `); }
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
    if (!result.alreadyApproved) console.log("Read-only operator-approval preflight complete. Rerun with --submit to review fresh checks and enter the confirmation phrase.");
    return;
  }
  console.log(`Operator approval verified: true`);
  console.log(`Approval transaction: ${result.transactionHash}`);
  console.log(`Sepolia Etherscan: https://sepolia.etherscan.io/tx/${result.transactionHash}`);
}

main().catch((error: unknown) => {
  if (error instanceof OperatorApprovalError) {
    console.error(`Operator approval stopped: ${error.message}`);
    if (error.transactionHash) console.error(`Transaction: ${error.transactionHash}\nSepolia Etherscan: https://sepolia.etherscan.io/tx/${error.transactionHash}`);
  } else {
    const name = error instanceof Error ? error.name : "unknown error";
    console.error(`Operator approval stopped (${name}). Sensitive provider details were withheld.`);
  }
  process.exitCode = 1;
});
