import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  CONDITION_RECORD_DIRECTORY,
  loadConditionRecord,
} from "./lib/condition-inspector.js";
import {
  INTEGRATION_ADDRESSES,
  loadIntegrationArtifacts,
  loadRpcUrl,
} from "./lib/sepolia-integration-preflight.js";
import { loadLocalEnv } from "./lib/load-local-env.js";
import {
  SPLIT_AMOUNT,
  SPLIT_CONFIRMATION,
  SPLIT_CONDITION_ID,
  SPLIT_QUESTION_ID,
  SPLIT_WALLET,
  parseSplitMode,
  runSepoliaBinarySplit,
  SepoliaSplitError,
  type SplitReader,
  type SplitResult,
} from "./lib/sepolia-binary-split.js";

const RECORD_PATH = resolve(
  process.cwd(),
  CONDITION_RECORD_DIRECTORY,
  `${SPLIT_QUESTION_ID.slice(2)}.json`,
);

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown error";
}

function printPreflight(result: SplitResult): void {
  console.log("Operation: LocalCTFAdapter.splitBinary(oracle, questionId, amount)");
  console.log("Network: Ethereum Sepolia (chain ID 11155111)");
  console.log(`CTF: ${result.ctf}`);
  console.log(`MockCollateral: ${result.collateral}`);
  console.log(`LocalCTFAdapter: ${result.adapter}`);
  console.log(`Wallet: ${result.wallet}`);
  console.log(`Oracle: ${result.oracle}`);
  console.log(`Question ID: ${result.questionId}`);
  console.log(`Condition ID: ${result.conditionId}`);
  console.log(`Amount: ${formatUnits(result.amount, 18)} MOCK (${result.amount} base units)`);
  console.log(`Wallet MOCK balance: ${formatUnits(result.tokenBalance, 18)} MOCK`);
  console.log(`Current adapter allowance: ${formatUnits(result.allowance, 18)} MOCK`);
  console.log(`YES position ID: ${result.yesPositionId}`);
  console.log(`NO position ID: ${result.noPositionId}`);
  console.log(`YES balance before: ${result.yesBalanceBefore}`);
  console.log(`NO balance before: ${result.noBalanceBefore}`);
  console.log(`Estimated gas: ${result.gasEstimate}`);
  console.log("Split simulation succeeded. No transaction has been sent.");
}

async function main(): Promise<void> {
  const mode = parseSplitMode(process.argv.slice(2));
  const record = await loadConditionRecord(RECORD_PATH);
  if (record.questionId.toLowerCase() !== SPLIT_QUESTION_ID.toLowerCase() ||
      record.conditionId.toLowerCase() !== SPLIT_CONDITION_ID.toLowerCase()) {
    throw new SepoliaSplitError("Saved condition record does not match the expected original condition.");
  }

  const artifacts = await loadIntegrationArtifacts();
  const splitAbiEntry = artifacts.adapter.abi.find((entry) =>
    entry.type === "function" && entry.name === "splitBinary" &&
    entry.inputs?.map((input) => input.type).join(",") === "address,bytes32,uint256",
  );
  if (!splitAbiEntry) {
    throw new SepoliaSplitError("LocalCTFAdapter artifact is missing splitBinary(address,bytes32,uint256).");
  }
  const rpcUrl = await loadRpcUrl(process.env.SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const reader: SplitReader = {
    getChainId: () => publicClient.getChainId(),
    getCode: (address) => publicClient.getCode({ address }),
    getAdapterCtf: () => publicClient.readContract({
      address: INTEGRATION_ADDRESSES.adapter,
      abi: artifacts.adapter.abi,
      functionName: "ctf",
    } as never) as Promise<Address>,
    getAdapterCollateral: () => publicClient.readContract({
      address: INTEGRATION_ADDRESSES.adapter,
      abi: artifacts.adapter.abi,
      functionName: "collateral",
    } as never) as Promise<Address>,
    getConditionId: () => publicClient.readContract({
      address: INTEGRATION_ADDRESSES.ctf,
      abi: artifacts.ctf.abi,
      functionName: "getConditionId",
      args: [record.oracle, record.questionId, 2n],
    } as never) as Promise<Hex>,
    getOutcomeSlotCount: (conditionId) => publicClient.readContract({
      address: INTEGRATION_ADDRESSES.ctf,
      abi: artifacts.ctf.abi,
      functionName: "getOutcomeSlotCount",
      args: [conditionId],
    } as never) as Promise<bigint>,
    getPayoutDenominator: (conditionId) => publicClient.readContract({
      address: INTEGRATION_ADDRESSES.ctf,
      abi: artifacts.ctf.abi,
      functionName: "payoutDenominator",
      args: [conditionId],
    } as never) as Promise<bigint>,
    getTokenDecimals: () => publicClient.readContract({
      address: INTEGRATION_ADDRESSES.collateral,
      abi: artifacts.collateral.abi,
      functionName: "decimals",
    } as never) as Promise<number>,
    getTokenBalance: (wallet) => publicClient.readContract({
      address: INTEGRATION_ADDRESSES.collateral,
      abi: artifacts.collateral.abi,
      functionName: "balanceOf",
      args: [wallet],
    } as never) as Promise<bigint>,
    getAllowance: (wallet) => publicClient.readContract({
      address: INTEGRATION_ADDRESSES.collateral,
      abi: artifacts.collateral.abi,
      functionName: "allowance",
      args: [wallet, INTEGRATION_ADDRESSES.adapter],
    } as never) as Promise<bigint>,
    getPositionIds: async (oracle, questionId) => {
      const values = await publicClient.readContract({
        address: INTEGRATION_ADDRESSES.adapter,
        abi: artifacts.adapter.abi,
        functionName: "getBinaryPositionIds",
        args: [oracle, questionId],
      } as never) as readonly [Hex, Hex, Hex, bigint, bigint];
      return { conditionId: values[0], yesPositionId: values[3], noPositionId: values[4] };
    },
    getPositionBalance: (wallet, positionId) => publicClient.readContract({
      address: INTEGRATION_ADDRESSES.ctf,
      abi: artifacts.ctf.abi,
      functionName: "balanceOf",
      args: [wallet, positionId],
    } as never) as Promise<bigint>,
    simulateSplit: async (wallet, oracle, questionId, amount) => {
      await publicClient.simulateContract({
        account: wallet,
        address: INTEGRATION_ADDRESSES.adapter,
        abi: artifacts.adapter.abi,
        functionName: "splitBinary",
        args: [oracle, questionId, amount],
      } as never);
    },
    estimateSplit: (wallet, oracle, questionId, amount) => publicClient.estimateContractGas({
      account: wallet,
      address: INTEGRATION_ADDRESSES.adapter,
      abi: artifacts.adapter.abi,
      functionName: "splitBinary",
      args: [oracle, questionId, amount],
    } as never),
    submitSplit: async (wallet, oracle, questionId, amount) => {
      // Load the private key and construct a wallet client only after the exact interactive confirmation.
      loadLocalEnv();
      const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
      if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
        throw new SepoliaSplitError("A valid SEPOLIA_PRIVATE_KEY is required for the confirmed split.");
      }
      const account = privateKeyToAccount(privateKey as Hex);
      if (account.address.toLowerCase() !== wallet.toLowerCase()) {
        throw new SepoliaSplitError("Configured signer does not match the expected wallet; no split was sent.");
      }
      const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
      return walletClient.writeContract({
        account,
        address: INTEGRATION_ADDRESSES.adapter,
        abi: artifacts.adapter.abi,
        functionName: "splitBinary",
        args: [oracle, questionId, amount],
      } as never);
    },
    waitForReceipt: async (hash) => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
      return receipt.status;
    },
  };

  const result = await runSepoliaBinarySplit(
    SPLIT_WALLET,
    record.oracle,
    record,
    mode === "submit" ? async () => {
      const prompt = createInterface({ input: stdin, output: stdout });
      try {
        return await prompt.question(`To split exactly 1 MOCK, type exactly: ${SPLIT_CONFIRMATION}\n> `);
      } finally {
        prompt.close();
      }
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
    console.log("Read-only split preflight complete. To request submission, rerun with --submit; fresh checks will be shown before the confirmation prompt.");
    return;
  }
  console.log(`YES balance after: ${result.yesBalanceAfter}`);
  console.log(`NO balance after: ${result.noBalanceAfter}`);
  console.log(`Split transaction: ${result.transactionHash}`);
  console.log(`Sepolia Etherscan: https://sepolia.etherscan.io/tx/${result.transactionHash}`);
  console.log("No ERC-1155 operator approval, merge, redemption, or payout report was performed.");
}

main().catch((error: unknown) => {
  if (error instanceof SepoliaSplitError) {
    console.error(`Sepolia split stopped: ${error.message}`);
    if (error.transactionHash) {
      console.error(`Transaction: ${error.transactionHash}`);
      console.error(`Sepolia Etherscan: https://sepolia.etherscan.io/tx/${error.transactionHash}`);
    }
  } else {
    console.error(`Sepolia split stopped (${safeErrorName(error)}). Sensitive provider details were withheld.`);
  }
  process.exitCode = 1;
});
