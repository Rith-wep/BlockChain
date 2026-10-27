import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
