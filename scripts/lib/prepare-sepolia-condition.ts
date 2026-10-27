import {
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import type { BinaryConditionRecord } from "./condition-inspector.js";

export const PREPARE_CONDITION_CONFIRMATION_NAME =
  "CONFIRM_PREPARE_SEPOLIA_CTF_CONDITION";
export const PREPARE_CONDITION_CONFIRMATION =
  "I_UNDERSTAND_THIS_PREPARES_THE_SEPOLIA_CTF_CONDITION";
export const EXPECTED_PREPARE_RECORD = {
  ctfAddress: "0x0CF01081fa2843BD187AC1A52C5a32C02211ee36" as Address,
  oracle: "0x8cfbcfc0e1c974970f03627e820ded0c95a7b6fa" as Address,
  questionId:
    "0x73ab19f7f6dbc9776a16fb868152cc24c8a8bb377e5e8af87a96f29c54bf60be" as Hex,
  conditionId:
    "0xededc961c06f120960547f392e1623a6ba2d46a68badafc28ee81f99b45b4cec" as Hex,
} as const;

export type PreparationReader = {
  getChainId(): Promise<number>;
  getCode(address: Address): Promise<Hex | undefined>;
  getConditionId(ctf: Address, oracle: Address, questionId: Hex): Promise<Hex>;
  getOutcomeSlotCount(ctf: Address, conditionId: Hex): Promise<bigint>;
  getPayoutDenominator(ctf: Address, conditionId: Hex): Promise<bigint>;
  simulate(ctf: Address, oracle: Address, questionId: Hex): Promise<void>;
  estimateGas(ctf: Address, oracle: Address, questionId: Hex): Promise<bigint>;
  submit?: (ctf: Address, oracle: Address, questionId: Hex) => Promise<Hex>;
  waitForReceipt?: (hash: Hex) => Promise<"success" | "reverted">;
};

export type PreparationResult = {
  ctfAddress: Address;
  oracle: Address;
  questionId: Hex;
  conditionId: Hex;
  gasEstimate: bigint;
  submitted: boolean;
  transactionHash?: Hex;
};

export class ConditionPreparationError extends Error {
  constructor(message: string, readonly transactionHash?: Hex) {
    super(message);
    this.name = "ConditionPreparationError";
  }
}

function fail(message: string): never {
  throw new ConditionPreparationError(message);
}

export function validateSavedConditionRecord(
  value: unknown,
): BinaryConditionRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("Saved condition record is not a JSON object.");
  }
  const record = value as Partial<BinaryConditionRecord>;
  if (record.network !== "sepolia" || record.chainId !== 11155111) {
    fail("Saved record must identify Ethereum Sepolia (chain ID 11155111).");
  }
  if (typeof record.ctfAddress !== "string" ||
      typeof record.oracle !== "string" ||
      typeof record.questionId !== "string" ||
      typeof record.conditionId !== "string" ||
      record.ctfAddress.toLowerCase() !== EXPECTED_PREPARE_RECORD.ctfAddress.toLowerCase() ||
      record.oracle.toLowerCase() !== EXPECTED_PREPARE_RECORD.oracle.toLowerCase() ||
      record.questionId.toLowerCase() !== EXPECTED_PREPARE_RECORD.questionId.toLowerCase() ||
      record.conditionId.toLowerCase() !== EXPECTED_PREPARE_RECORD.conditionId.toLowerCase()) {
    fail("Saved record does not match the approved CTF, oracle, question ID, and condition ID.");
  }
  if (typeof record.description !== "string" || record.description.trim() === "" ||
      typeof record.nonce !== "string" || record.nonce.trim() === "") {
    fail("Saved record must contain its original description and nonce.");
  }
  const recomputedQuestionId = keccak256(
    stringToHex(`${record.description}|${record.nonce}`),
  );
  if (recomputedQuestionId.toLowerCase() !== EXPECTED_PREPARE_RECORD.questionId.toLowerCase()) {
    fail("Saved description and nonce do not reproduce the recorded question ID.");
  }
  return record as BinaryConditionRecord;
}

export async function runConditionPreparation(
  record: BinaryConditionRecord,
  confirmation: string | undefined,
  reader: PreparationReader,
  onPreflight?: (result: PreparationResult) => void,
): Promise<PreparationResult> {
  // Revalidate even when callers already validated the disk record.
  validateSavedConditionRecord(record);
  let chainId: number;
  try {
    chainId = await reader.getChainId();
  } catch {
    fail("Sepolia chain-ID request failed; provider details were withheld.");
  }
  if (chainId !== 11155111) fail(`RPC chain ID is ${chainId}; expected Sepolia 11155111.`);

  let code: Hex | undefined;
  try {
    code = await reader.getCode(record.ctfAddress);
  } catch {
    fail("CTF contract-code request failed; provider details were withheld.");
  }
  if (code === undefined || code === "0x") fail("The expected CTF address has no contract code on Sepolia.");

  let conditionId: Hex;
  try {
    conditionId = await reader.getConditionId(record.ctfAddress, record.oracle, record.questionId);
  } catch {
    fail("Official CTF condition-ID read failed; provider details were withheld.");
  }
  if (conditionId.toLowerCase() !== EXPECTED_PREPARE_RECORD.conditionId.toLowerCase()) {
    fail("The official CTF returned a condition ID different from the saved expected ID.");
  }

  let slotCount: bigint;
  let payoutDenominator: bigint;
  try {
    [slotCount, payoutDenominator] = await Promise.all([
      reader.getOutcomeSlotCount(record.ctfAddress, conditionId),
      reader.getPayoutDenominator(record.ctfAddress, conditionId),
    ]);
  } catch {
    fail("CTF condition-status read failed; provider details were withheld.");
  }
  if (slotCount !== 0n) {
    fail(`Condition is already prepared (outcome slot count ${slotCount}); no transaction was sent.`);
  }
  if (payoutDenominator !== 0n) {
    fail("Condition has a nonzero payout denominator despite having no outcome slots; refusing to proceed.");
  }

  try {
    await reader.simulate(record.ctfAddress, record.oracle, record.questionId);
  } catch {
    fail("CTF preparation simulation failed; no transaction was sent and provider details were withheld.");
  }
  let gasEstimate: bigint;
  try {
    gasEstimate = await reader.estimateGas(record.ctfAddress, record.oracle, record.questionId);
  } catch {
    fail("CTF preparation gas estimate failed; no transaction was sent and provider details were withheld.");
  }

  const result: PreparationResult = {
    ctfAddress: record.ctfAddress,
    oracle: record.oracle,
    questionId: record.questionId,
    conditionId,
    gasEstimate,
    submitted: false,
  };
  onPreflight?.(result);
  if (confirmation === undefined || confirmation === "") return result;
  if (confirmation !== PREPARE_CONDITION_CONFIRMATION) {
    fail(`Confirmation did not match. Exact required phrase: ${PREPARE_CONDITION_CONFIRMATION}`);
  }
  if (!reader.submit || !reader.waitForReceipt) {
    fail("Confirmed submission was requested but no transaction sender is configured.");
  }

  let transactionHash: Hex;
  try {
    // Repeat the critical state check immediately before the only permitted write.
    const latestSlots = await reader.getOutcomeSlotCount(record.ctfAddress, conditionId);
    const latestDenominator = await reader.getPayoutDenominator(record.ctfAddress, conditionId);
    if (latestSlots !== 0n || latestDenominator !== 0n) {
      fail("Condition state changed after simulation; refusing to submit.");
    }
    await reader.simulate(record.ctfAddress, record.oracle, record.questionId);
    transactionHash = await reader.submit(record.ctfAddress, record.oracle, record.questionId);
    result.transactionHash = transactionHash;
  } catch (error) {
    if (error instanceof ConditionPreparationError) throw error;
    fail("Submission request failed without a confirmed transaction hash; broadcast status may be unknown. Check the wallet or explorer before retrying; provider details were withheld.");
  }

  let receiptStatus: "success" | "reverted";
  try {
    receiptStatus = await reader.waitForReceipt(transactionHash);
  } catch {
    throw new ConditionPreparationError(
      "Could not confirm the preparation receipt; check this transaction hash before retrying.",
      transactionHash,
    );
  }
  if (receiptStatus !== "success") {
    throw new ConditionPreparationError("Preparation transaction receipt indicates failure.", transactionHash);
  }
  result.submitted = true;
  try {
    const preparedSlots = await reader.getOutcomeSlotCount(record.ctfAddress, conditionId);
    if (preparedSlots !== 2n) {
      throw new ConditionPreparationError(
        `Receipt succeeded, but outcome slot count is ${preparedSlots}, not 2.`,
        transactionHash,
      );
    }
  } catch (error) {
    if (error instanceof ConditionPreparationError) throw error;
    throw new ConditionPreparationError(
      "Receipt succeeded, but post-transaction condition verification failed; provider details were withheld.",
      transactionHash,
    );
  }
  return result;
}
