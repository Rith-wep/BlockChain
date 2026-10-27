import type { Address, Hex } from "viem";
import { SPLIT_AMOUNT } from "./sepolia-binary-split.js";
import {
  verifyPositionContext,
  type PositionArtifacts,
  type PositionContext,
  type PositionContextReader,
  type SavedPositionCondition,
} from "./sepolia-position-context.js";

export const MERGE_CONFIRMATION = "I_CONFIRM_MERGE_1_MOCK_ON_SEPOLIA";

export function parseMergeMode(args: readonly string[]): "preflight" | "submit" {
  if (args.length === 0) return "preflight";
  if (args.length === 1 && args[0] === "--submit") return "submit";
  throw new Error("Use no arguments for read-only preflight, or --submit for the separately confirmed merge flow.");
}

export type BinaryMergeReader = PositionContextReader & {
  getOperatorApproval(wallet: Address, operator: Address): Promise<boolean>;
  getPositionBalance(wallet: Address, positionId: bigint): Promise<bigint>;
  getCollateralBalance(wallet: Address): Promise<bigint>;
  simulateMerge(wallet: Address, oracle: Address, questionId: Hex, amount: bigint): Promise<void>;
  estimateMerge(wallet: Address, oracle: Address, questionId: Hex, amount: bigint): Promise<bigint>;
  submitMerge?: (wallet: Address, oracle: Address, questionId: Hex, amount: bigint) => Promise<Hex>;
  waitForReceipt?: (hash: Hex) => Promise<"success" | "reverted">;
};

export type BinaryMergeResult = {
  context: PositionContext;
  yesBalanceBefore: bigint;
  noBalanceBefore: bigint;
  collateralBalanceBefore: bigint;
  gasEstimate: bigint;
  submitted: boolean;
  transactionHash?: Hex;
  yesBalanceAfter?: bigint;
  noBalanceAfter?: bigint;
  collateralBalanceAfter?: bigint;
};

export class BinaryMergeError extends Error {
  constructor(message: string, readonly transactionHash?: Hex) {
    super(message);
    this.name = "BinaryMergeError";
  }
}

function fail(message: string): never {
  throw new BinaryMergeError(message);
}

export async function runBinaryMerge(
  wallet: Address,
  record: SavedPositionCondition,
  requestConfirmation: (() => Promise<string>) | undefined,
  reader: BinaryMergeReader,
  artifacts: PositionArtifacts,
  onPreflight?: (result: BinaryMergeResult) => void,
): Promise<BinaryMergeResult> {
  let context: PositionContext;
  let approved: boolean;
  let yesBalanceBefore: bigint;
  let noBalanceBefore: bigint;
  let collateralBalanceBefore: bigint;
  try {
    context = await verifyPositionContext(wallet, record, reader, artifacts);
    [approved, yesBalanceBefore, noBalanceBefore, collateralBalanceBefore] = await Promise.all([
      reader.getOperatorApproval(wallet, context.adapter),
      reader.getPositionBalance(wallet, context.yesPositionId),
      reader.getPositionBalance(wallet, context.noPositionId),
      reader.getCollateralBalance(wallet),
    ]);
  } catch (error) {
    if (error instanceof BinaryMergeError) throw error;
    if (error instanceof Error && error.name === "PositionContextError") fail(error.message);
    fail("Merge preflight read failed; provider details were withheld.");
  }
  if (!approved) fail("ERC-1155 operator approval for the adapter is not enabled.");
  if (yesBalanceBefore < SPLIT_AMOUNT || noBalanceBefore < SPLIT_AMOUNT) {
    fail("Wallet must own at least 1 YES and 1 NO position to merge 1 MOCK.");
  }

  try {
    await reader.simulateMerge(wallet, context.oracle, context.questionId, SPLIT_AMOUNT);
  } catch {
    fail("Exact merge simulation failed; no transaction was sent and provider details were withheld.");
  }
  let gasEstimate: bigint;
  try {
    gasEstimate = await reader.estimateMerge(wallet, context.oracle, context.questionId, SPLIT_AMOUNT);
  } catch {
    fail("Merge gas estimate failed; no transaction was sent and provider details were withheld.");
  }
  const result: BinaryMergeResult = {
    context,
    yesBalanceBefore,
    noBalanceBefore,
    collateralBalanceBefore,
    gasEstimate,
    submitted: false,
  };
  onPreflight?.(result);
  if (!requestConfirmation) return result;
  let confirmation: string;
  try {
    confirmation = await requestConfirmation();
  } catch {
    fail("Confirmation input failed; no merge was sent.");
  }
  if (confirmation !== MERGE_CONFIRMATION) {
    fail(`Confirmation did not match. Exact required phrase: ${MERGE_CONFIRMATION}`);
  }
  if (!reader.submitMerge || !reader.waitForReceipt) fail("Confirmed merge requested but no transaction sender is configured.");

  try {
    const freshContext = await verifyPositionContext(wallet, record, reader, artifacts);
    const [freshApproval, freshYes, freshNo, freshCollateral] = await Promise.all([
      reader.getOperatorApproval(wallet, context.adapter),
      reader.getPositionBalance(wallet, context.yesPositionId),
      reader.getPositionBalance(wallet, context.noPositionId),
      reader.getCollateralBalance(wallet),
    ]);
    if (freshContext.conditionId.toLowerCase() !== context.conditionId.toLowerCase() || !freshApproval) {
      fail("Condition or operator approval changed after preflight; rerun and review before retrying.");
    }
    if (freshYes !== yesBalanceBefore || freshNo !== noBalanceBefore || freshCollateral !== collateralBalanceBefore) {
      fail("Wallet balances changed after the displayed preflight; rerun and review before merging.");
    }
    await reader.simulateMerge(wallet, context.oracle, context.questionId, SPLIT_AMOUNT);
  } catch (error) {
    if (error instanceof BinaryMergeError) throw error;
    if (error instanceof Error && error.name === "PositionContextError") fail(error.message);
    fail("Final merge recheck or simulation failed; no transaction was sent and provider details were withheld.");
  }

  let hash: Hex;
  try {
    hash = await reader.submitMerge(wallet, context.oracle, context.questionId, SPLIT_AMOUNT);
  } catch (error) {
    if (error instanceof BinaryMergeError) throw error;
    fail("Merge submission failed without a confirmed transaction hash; broadcast status may be unknown. Check before retrying; provider details were withheld.");
  }
  let receiptStatus: "success" | "reverted";
  try {
    receiptStatus = await reader.waitForReceipt(hash);
  } catch {
    throw new BinaryMergeError("Could not confirm the merge receipt; check this transaction hash before retrying.", hash);
  }
  if (receiptStatus !== "success") throw new BinaryMergeError("Merge receipt indicates failure.", hash);

  let yesBalanceAfter: bigint;
  let noBalanceAfter: bigint;
  let collateralBalanceAfter: bigint;
  try {
    [yesBalanceAfter, noBalanceAfter, collateralBalanceAfter] = await Promise.all([
      reader.getPositionBalance(wallet, context.yesPositionId),
      reader.getPositionBalance(wallet, context.noPositionId),
      reader.getCollateralBalance(wallet),
    ]);
  } catch {
    throw new BinaryMergeError("Merge receipt succeeded, but post-merge balance verification failed.", hash);
  }
  if (yesBalanceAfter !== yesBalanceBefore - SPLIT_AMOUNT ||
      noBalanceAfter !== noBalanceBefore - SPLIT_AMOUNT ||
      collateralBalanceAfter !== collateralBalanceBefore + SPLIT_AMOUNT) {
    throw new BinaryMergeError("Receipt succeeded, but wallet balances did not change by exactly -1 YES, -1 NO, and +1 MOCK.", hash);
  }
  result.submitted = true;
  result.transactionHash = hash;
  result.yesBalanceAfter = yesBalanceAfter;
  result.noBalanceAfter = noBalanceAfter;
  result.collateralBalanceAfter = collateralBalanceAfter;
  return result;
}
