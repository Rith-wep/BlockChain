import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  CONDITION_RECORD_DIRECTORY,
  type BinaryConditionRecord,
} from "./lib/condition-inspector.js";
import {
  ConditionPreparationError,
  EXPECTED_PREPARE_RECORD,
  PREPARE_CONDITION_CONFIRMATION,
  PREPARE_CONDITION_CONFIRMATION_NAME,
  runConditionPreparation,
  validateSavedConditionRecord,
  type PreparationReader,
} from "./lib/prepare-sepolia-condition.js";
import { loadLocalEnv } from "./lib/load-local-env.js";
import {
  INTEGRATION_ADDRESSES,
  loadIntegrationArtifacts,
  loadRpcUrl,
} from "./lib/sepolia-integration-preflight.js";

const RECORD_PATH = resolve(
  process.cwd(),
  CONDITION_RECORD_DIRECTORY,
  `${EXPECTED_PREPARE_RECORD.questionId.slice(2)}.json`,
);

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown error";
}

async function readSavedRecord(): Promise<BinaryConditionRecord> {
  let raw: string;
  try {
    raw = await readFile(RECORD_PATH, "utf8");
  } catch {
    throw new ConditionPreparationError("Expected saved condition record is missing or unreadable.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new ConditionPreparationError("Expected saved condition record is not valid JSON.");
  }
  return validateSavedConditionRecord(parsed);
}

async function main(): Promise<void> {
  const record = await readSavedRecord();
  if (record.ctfAddress.toLowerCase() !== INTEGRATION_ADDRESSES.ctf.toLowerCase()) {
    throw new ConditionPreparationError("Saved CTF address does not match the expected Sepolia CTF address.");
  }
  const artifacts = await loadIntegrationArtifacts();
  const rpcUrl = await loadRpcUrl(process.env.SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  const reader: PreparationReader = {
    getChainId: () => publicClient.getChainId(),
    getCode: async (address) => {
      const deployed = await publicClient.getCode({ address });
      if (deployed?.toLowerCase() !== artifacts.ctf.runtime.toLowerCase()) {
        throw new ConditionPreparationError("CTF runtime does not match the pinned local ConditionalTokens artifact.");
      }
      return deployed;
    },
    getConditionId: async (ctf, oracle, questionId) => publicClient.readContract({
      address: ctf,
      abi: artifacts.ctf.abi,
      functionName: "getConditionId",
      args: [oracle, questionId, 2n],
    } as never) as Promise<Hex>,
    getOutcomeSlotCount: async (ctf, conditionId) => publicClient.readContract({
      address: ctf,
      abi: artifacts.ctf.abi,
      functionName: "getOutcomeSlotCount",
      args: [conditionId],
    } as never) as Promise<bigint>,
    getPayoutDenominator: async (ctf, conditionId) => publicClient.readContract({
      address: ctf,
      abi: artifacts.ctf.abi,
      functionName: "payoutDenominator",
      args: [conditionId],
    } as never) as Promise<bigint>,
    simulate: async (ctf, oracle, questionId) => {
      await publicClient.simulateContract({
        account: oracle,
        address: ctf,
        abi: artifacts.ctf.abi,
        functionName: "prepareCondition",
        args: [oracle, questionId, 2n],
      } as never);
    },
    estimateGas: (ctf, oracle, questionId) => publicClient.estimateContractGas({
      account: oracle,
      address: ctf,
      abi: artifacts.ctf.abi,
      functionName: "prepareCondition",
      args: [oracle, questionId, 2n],
    } as never),
    submit: async (ctf, oracle, questionId) => {
      // Private-key loading and wallet creation are deferred until after the exact confirmation.
      loadLocalEnv();
      const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
      if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
        throw new ConditionPreparationError("A valid SEPOLIA_PRIVATE_KEY is required for confirmed submission.");
      }
      const account = privateKeyToAccount(privateKey as Hex);
      if (account.address.toLowerCase() !== oracle.toLowerCase()) {
        throw new ConditionPreparationError("Configured signer does not match the condition oracle; no transaction was sent.");
      }
      const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
      return walletClient.writeContract({
        account,
        address: ctf,
        abi: artifacts.ctf.abi,
        functionName: "prepareCondition",
        args: [oracle, questionId, 2n],
      } as never);
    },
    waitForReceipt: async (hash) => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
      return receipt.status;
    },
  };

  const confirmation = process.env[PREPARE_CONDITION_CONFIRMATION_NAME];
  const result = await runConditionPreparation(record, confirmation, reader, (plan) => {
    console.log("Operation: ConditionalTokens.prepareCondition(oracle, questionId, 2)");
    console.log(`CTF: ${plan.ctfAddress}`);
    console.log(`Oracle: ${plan.oracle}`);
    console.log(`Question ID: ${plan.questionId}`);
    console.log(`Condition ID: ${plan.conditionId}`);
    console.log(`Outcome slots: 2`);
    console.log(`Estimated gas: ${plan.gasEstimate}`);
    console.log("Simulation succeeded. No transaction has been sent yet.");
  });
  if (!result.submitted) {
    console.log(`Read-only preparation preflight complete. To submit later, set ${PREPARE_CONDITION_CONFIRMATION_NAME}=${PREPARE_CONDITION_CONFIRMATION} and rerun this command.`);
    return;
  }
  console.log(`Preparation transaction: ${result.transactionHash}`);
  console.log("Receipt succeeded with two confirmations; getOutcomeSlotCount(conditionId) is 2.");
  console.log("Only the saved binary condition was prepared. No payouts or token operations were performed.");
}

main().catch((error: unknown) => {
  if (error instanceof ConditionPreparationError) {
    console.error(`Condition preparation stopped: ${error.message}`);
    if (error.transactionHash) console.error(`Check transaction: ${error.transactionHash}`);
  } else {
    // Provider/client messages may contain credential-bearing endpoint details.
    console.error(`Condition preparation stopped (${safeErrorName(error)}). Sensitive provider details were withheld.`);
  }
  process.exitCode = 1;
});
