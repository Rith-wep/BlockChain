import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  keccak256,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import type { IntegrationReader } from "./sepolia-integration-preflight.js";

export const CONDITION_INSPECTOR_ORACLE =
  "0x8cfbcfc0e1c974970f03627e820ded0c95a7b6fa" as Address;
export const CONDITION_INSPECTOR_CTF =
  "0x0CF01081fa2843BD187AC1A52C5a32C02211ee36" as Address;
export const CONDITION_RECORD_DIRECTORY = "test-records/ctf-conditions";

export type BinaryConditionStatus = {
  conditionId: Hex;
  outcomeSlotCount: bigint;
  payoutDenominator: bigint;
  prepared: boolean;
  resolved: boolean;
};

export type BinaryConditionRecord = {
  network: "sepolia";
  chainId: 11155111;
  ctfAddress: Address;
  description: string;
  nonce: string;
  questionId: Hex;
  oracle: Address;
  conditionId: Hex;
  outcomeSlotCount: string;
  payoutDenominator: string;
  prepared: boolean;
  resolved: boolean;
};

export type ConditionInspectorCommand =
  | { mode: "inspect-question-id"; questionId: Hex }
  | { mode: "inspect-record"; recordPath: string }
  | { mode: "create"; description: string };

export function parseConditionInspectorCommand(args: readonly string[]): ConditionInspectorCommand {
  if (args.length === 2 && args[0] === "--question-id" && /^0x[0-9a-fA-F]{64}$/.test(args[1] ?? "")) {
    return { mode: "inspect-question-id", questionId: args[1] as Hex };
  }
  if (args.length === 2 && args[0] === "--record" && (args[1] ?? "").trim() !== "") {
    return { mode: "inspect-record", recordPath: args[1] as string };
  }
  if (args.length >= 2 && args[0] === "--create" && args.slice(1).join(" ").trim() !== "") {
    return { mode: "create", description: args.slice(1).join(" ").trim() };
  }
  throw new Error(
    'Choose one explicit mode: --question-id <bytes32>, --record <saved-json-path>, or --create "<new question description>".',
  );
}

export async function loadConditionRecord(path: string): Promise<BinaryConditionRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new Error("Saved condition record is missing, unreadable, or invalid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Saved condition record must be a JSON object.");
  }
  const record = parsed as Partial<BinaryConditionRecord>;
  if (record.network !== "sepolia" || record.chainId !== 11155111 ||
      typeof record.ctfAddress !== "string" ||
      typeof record.oracle !== "string" ||
      record.ctfAddress.toLowerCase() !== CONDITION_INSPECTOR_CTF.toLowerCase() ||
      record.oracle.toLowerCase() !== CONDITION_INSPECTOR_ORACLE.toLowerCase() ||
      typeof record.description !== "string" || record.description.trim() === "" ||
      typeof record.nonce !== "string" || record.nonce.trim() === "" ||
      typeof record.questionId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(record.questionId) ||
      typeof record.conditionId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(record.conditionId)) {
    throw new Error("Saved condition record has missing or unexpected identity fields.");
  }
  if (createQuestionId(record.description, record.nonce).toLowerCase() !== record.questionId.toLowerCase()) {
    throw new Error("Saved description and nonce do not reproduce the saved question ID.");
  }
  return record as BinaryConditionRecord;
}

export async function updateConditionRecordStatus(
  recordPath: string,
  record: BinaryConditionRecord,
  status: BinaryConditionStatus,
): Promise<BinaryConditionRecord> {
  if (status.conditionId.toLowerCase() !== record.conditionId.toLowerCase()) {
    throw new Error("On-chain condition ID differs from the saved record; status was not updated.");
  }
  const updated: BinaryConditionRecord = {
    ...record,
    outcomeSlotCount: status.outcomeSlotCount.toString(),
    payoutDenominator: status.payoutDenominator.toString(),
    prepared: status.prepared,
    resolved: status.resolved,
  };
  const absolutePath = resolve(recordPath);
  const temporaryPath = resolve(
    dirname(absolutePath),
    `.${basename(absolutePath)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, absolutePath);
  } catch {
    throw new Error("Verified chain status could not be saved to the local record.");
  }
  return updated;
}

export function createQuestionId(description: string, nonce: string): Hex {
  if (description.trim() === "") throw new Error("Question description cannot be empty.");
  if (nonce.trim() === "") throw new Error("Question nonce cannot be empty.");
  return keccak256(stringToHex(`${description}|${nonce}`));
}

export function interpretBinaryConditionStatus(
  outcomeSlotCount: bigint,
  payoutDenominator: bigint,
): Pick<BinaryConditionStatus, "prepared" | "resolved"> {
  return {
    prepared: outcomeSlotCount === 2n,
    resolved: payoutDenominator > 0n,
  };
}

export async function inspectBinaryCondition(
  reader: IntegrationReader,
  ctfAbi: Abi,
  oracle: Address,
  questionId: Hex,
): Promise<BinaryConditionStatus> {
  const conditionId = await reader.readContract<Hex>({
    address: CONDITION_INSPECTOR_CTF,
    abi: ctfAbi,
    functionName: "getConditionId",
    args: [oracle, questionId, 2n],
  });
  const [outcomeSlotCount, payoutDenominator] = await Promise.all([
    reader.readContract<bigint>({
      address: CONDITION_INSPECTOR_CTF,
      abi: ctfAbi,
      functionName: "getOutcomeSlotCount",
      args: [conditionId],
    }),
    reader.readContract<bigint>({
      address: CONDITION_INSPECTOR_CTF,
      abi: ctfAbi,
      functionName: "payoutDenominator",
      args: [conditionId],
    }),
  ]);
  return {
    conditionId,
    outcomeSlotCount,
    payoutDenominator,
    ...interpretBinaryConditionStatus(outcomeSlotCount, payoutDenominator),
  };
}

// Create a new JSON record exclusively; an existing ID is never overwritten.
export async function saveConditionRecord(
  record: BinaryConditionRecord,
  directory = resolve(process.cwd(), CONDITION_RECORD_DIRECTORY),
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${record.questionId.slice(2)}.json`);
  try {
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      throw new Error("A record for this question ID already exists; no file was overwritten.");
    }
    throw new Error("Could not save the local condition record.");
  }
  return path;
}
