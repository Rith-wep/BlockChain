import { randomUUID } from "node:crypto";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import {
  parseConditionInspectorCommand,
  loadConditionRecord,
  updateConditionRecordStatus,
  CONDITION_RECORD_DIRECTORY,
  createQuestionId,
  CONDITION_INSPECTOR_CTF,
  CONDITION_INSPECTOR_ORACLE,
  inspectBinaryCondition,
  saveConditionRecord,
  type BinaryConditionRecord,
} from "./lib/condition-inspector.js";
import {
  createArtifactReader,
  loadIntegrationArtifacts,
  loadRpcUrl,
  type IntegrationReader,
} from "./lib/sepolia-integration-preflight.js";
import type { Address, Hex } from "viem";
import { resolve } from "node:path";

type PublicClient = ReturnType<typeof createPublicClient>;

function createReader(publicClient: PublicClient): IntegrationReader {
  return {
    getChainId: () => publicClient.getChainId(),
    getCode: ({ address }) => publicClient.getCode({ address }),
    readContract: async <T = unknown>({ address, abi, functionName, args }): Promise<T> => {
      const read = createArtifactReader({ abi, runtime: "0x00", immutableReferences: [] });
      const callReader = publicClient as unknown as Parameters<typeof read>[0];
      return read<T>(callReader, address, functionName, args);
    },
  };
}

function printRecord(record: BinaryConditionRecord, recordPath: string): void {
  console.log(`Question description: ${record.description}`);
  console.log(`Nonce: ${record.nonce}`);
  console.log(`Question ID: ${record.questionId}`);
  console.log(`CTF: ${record.ctfAddress}`);
  console.log(`Oracle: ${record.oracle}`);
  console.log(`Condition ID: ${record.conditionId}`);
  console.log(`Outcome slot count: ${record.outcomeSlotCount}`);
  console.log(`Prepared binary condition: ${record.prepared}`);
  console.log(`Payout denominator: ${record.payoutDenominator}`);
  console.log(`Resolved: ${record.resolved}`);
  console.log(`Record: ${recordPath}`);
}

async function main(): Promise<void> {
  const command = parseConditionInspectorCommand(process.argv.slice(2));
  const rpcUrl = await loadRpcUrl(process.env.SEPOLIA_RPC_URL);
  const artifacts = await loadIntegrationArtifacts();
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const chainId = await publicClient.getChainId();
  if (chainId !== 11155111) throw new Error(`RPC chain ID is ${chainId}; expected Sepolia 11155111.`);
  const ctfCode = await publicClient.getCode({ address: CONDITION_INSPECTOR_CTF });
  if (ctfCode === undefined || ctfCode === "0x") {
    throw new Error("Expected ConditionalTokens address has no contract code on Sepolia.");
  }
  if (ctfCode.toLowerCase() !== artifacts.ctf.runtime.toLowerCase()) {
    throw new Error("ConditionalTokens runtime does not match the pinned local artifact.");
  }
  const reader = createReader(publicClient);

  if (command.mode === "create") {
    // Identity generation is only reachable through the explicit --create mode.
    const nonce = randomUUID();
    const questionId = createQuestionId(command.description, nonce);
    const status = await inspectBinaryCondition(
      reader,
      artifacts.ctf.abi,
      CONDITION_INSPECTOR_ORACLE,
      questionId,
    );
    const record: BinaryConditionRecord = {
      network: "sepolia",
      chainId: 11155111,
      ctfAddress: CONDITION_INSPECTOR_CTF,
      description: command.description,
      nonce,
      questionId,
      oracle: CONDITION_INSPECTOR_ORACLE,
      conditionId: status.conditionId,
      outcomeSlotCount: status.outcomeSlotCount.toString(),
      payoutDenominator: status.payoutDenominator.toString(),
      prepared: status.prepared,
      resolved: status.resolved,
    };
    const recordPath = await saveConditionRecord(record);
    console.log("Mode: create a new question (explicit --create requested).");
    printRecord(record, recordPath);
    console.log("Read-only inspection complete. No condition was prepared and no transaction was sent.");
    return;
  }

  let recordPath: string;
  if (command.mode === "inspect-question-id") {
    recordPath = resolve(process.cwd(), CONDITION_RECORD_DIRECTORY, `${command.questionId.slice(2)}.json`);
  } else {
    recordPath = resolve(process.cwd(), command.recordPath);
  }
  const record = await loadConditionRecord(recordPath);
  if (command.mode === "inspect-question-id" &&
      record.questionId.toLowerCase() !== command.questionId.toLowerCase()) {
    throw new Error("Saved record Question ID does not match the requested ID.");
  }

  const status = await inspectBinaryCondition(
    reader,
    artifacts.ctf.abi,
    record.oracle as Address,
    record.questionId as Hex,
  );
  if (status.conditionId.toLowerCase() !== record.conditionId.toLowerCase()) {
    throw new Error("Official CTF condition ID differs from the saved record; saved status was not changed.");
  }
  const updated = await updateConditionRecordStatus(recordPath, record, status);
  console.log(`Mode: inspect existing saved condition (${command.mode}).`);
  printRecord(updated, recordPath);
  console.log("Read-only Sepolia inspection complete. No transaction was signed or sent.");
}

main().catch((error: unknown) => {
  if (error instanceof Error && error.name === "SafeIntegrationPreflightError") {
    console.error(`Condition inspection stopped: ${"diagnostic" in error ? String(error.diagnostic) : error.message}`);
  } else if (error instanceof Error && /explicit mode|RPC chain ID|Saved|record|Could not save|Question ID|Official CTF/.test(error.message)) {
    console.error(`Condition inspection stopped: ${error.message}`);
  } else {
    const name = error instanceof Error ? error.name : "unknown";
    console.error(`Condition inspection stopped (unexpected ${name}). Raw RPC details were withheld.`);
  }
  process.exitCode = 1;
});
