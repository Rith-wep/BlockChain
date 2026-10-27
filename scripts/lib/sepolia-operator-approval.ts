import type { Address, Hex } from "viem";
import {
  SPLIT_AMOUNT,
  SPLIT_WALLET,
} from "./sepolia-binary-split.js";
import {
  verifyPositionContext,
  type PositionArtifacts,
  type PositionContext,
  type PositionContextReader,
  type SavedPositionCondition,
} from "./sepolia-position-context.js";

export const OPERATOR_APPROVAL_CONFIRMATION =
  "I_APPROVE_CTF_OPERATOR_FOR_ADAPTER_ON_SEPOLIA";

export function parseOperatorApprovalMode(args: readonly string[]): "preflight" | "submit" {
  if (args.length === 0) return "preflight";
  if (args.length === 1 && args[0] === "--submit") return "submit";
  throw new Error("Use no arguments for read-only preflight, or --submit for the confirmed operator approval flow.");
}

export type OperatorApprovalReader = PositionContextReader & {
  getOperatorApproval(wallet: Address, operator: Address): Promise<boolean>;
  getPositionBalance(wallet: Address, positionId: bigint): Promise<bigint>;
  simulateApproval(wallet: Address, operator: Address, approved: true): Promise<void>;
  estimateApproval(wallet: Address, operator: Address, approved: true): Promise<bigint>;
  submitApproval?: (wallet: Address, operator: Address, approved: true) => Promise<Hex>;
  waitForReceipt?: (hash: Hex) => Promise<"success" | "reverted">;
};

export type OperatorApprovalResult = {
  context: PositionContext;
  yesBalance: bigint;
  noBalance: bigint;
  alreadyApproved: boolean;
  gasEstimate: bigint;
  submitted: boolean;
  transactionHash?: Hex;
};

export class OperatorApprovalError extends Error {
  constructor(message: string, readonly transactionHash?: Hex) {
    super(message);
    this.name = "OperatorApprovalError";
  }
}

function fail(message: string): never {
  throw new OperatorApprovalError(message);
}

export async function runOperatorApproval(
  wallet: Address,
  record: SavedPositionCondition,
  requestConfirmation: (() => Promise<string>) | undefined,
  reader: OperatorApprovalReader,
  artifacts: PositionArtifacts,
  onPreflight?: (result: OperatorApprovalResult) => void,
): Promise<OperatorApprovalResult> {
  let context: PositionContext;
  let approved: boolean;
  let yesBalance: bigint;
  let noBalance: bigint;
  try {
    context = await verifyPositionContext(wallet, record, reader, artifacts);
    [approved, yesBalance, noBalance] = await Promise.all([
      reader.getOperatorApproval(wallet, context.adapter),
      reader.getPositionBalance(wallet, context.yesPositionId),
      reader.getPositionBalance(wallet, context.noPositionId),
    ]);
  } catch (error) {
    if (error instanceof OperatorApprovalError) throw error;
    if (error instanceof Error && error.name === "PositionContextError") fail(error.message);
    fail("Operator approval or outcome balance read failed; provider details were withheld.");
  }
  if (yesBalance < SPLIT_AMOUNT || noBalance < SPLIT_AMOUNT) {
    fail("Wallet must own at least 1 YES and 1 NO position before granting operator approval.");
  }

  let gasEstimate = 0n;
  if (!approved) {
    try {
      await reader.simulateApproval(wallet, context.adapter, true);
    } catch {
      fail("setApprovalForAll simulation failed; no transaction was sent and provider details were withheld.");
    }
    try {
      gasEstimate = await reader.estimateApproval(wallet, context.adapter, true);
    } catch {
      fail("setApprovalForAll gas estimate failed; no transaction was sent and provider details were withheld.");
    }
  }

  const result: OperatorApprovalResult = {
    context,
    yesBalance,
    noBalance,
    alreadyApproved: approved,
    gasEstimate,
    submitted: false,
  };
  onPreflight?.(result);
  if (approved || !requestConfirmation) return result;
  let confirmation: string;
  try {
    confirmation = await requestConfirmation();
  } catch {
    fail("Confirmation input failed; no transaction was sent.");
  }
  if (confirmation !== OPERATOR_APPROVAL_CONFIRMATION) {
    fail(`Confirmation did not match. Exact required phrase: ${OPERATOR_APPROVAL_CONFIRMATION}`);
  }
  if (!reader.submitApproval || !reader.waitForReceipt) fail("Confirmed approval requested but no transaction sender is configured.");

  try {
    const freshContext = await verifyPositionContext(wallet, record, reader, artifacts);
    const [freshApproval, freshYes, freshNo] = await Promise.all([
      reader.getOperatorApproval(wallet, context.adapter),
      reader.getPositionBalance(wallet, context.yesPositionId),
      reader.getPositionBalance(wallet, context.noPositionId),
    ]);
    if (freshContext.conditionId.toLowerCase() !== context.conditionId.toLowerCase() || freshApproval) {
      fail("Operator approval or condition changed after preflight; rerun and review before retrying.");
    }
    if (freshYes !== yesBalance || freshNo !== noBalance) {
      fail("YES or NO balance changed after the displayed preflight; rerun and review before retrying.");
    }
    await reader.simulateApproval(wallet, context.adapter, true);
  } catch (error) {
    if (error instanceof OperatorApprovalError) throw error;
    if (error instanceof Error && error.name === "PositionContextError") fail(error.message);
    fail("Final approval recheck or simulation failed; no transaction was sent and provider details were withheld.");
  }

  let hash: Hex;
  try {
    hash = await reader.submitApproval(wallet, context.adapter, true);
  } catch (error) {
    if (error instanceof OperatorApprovalError) throw error;
    fail("Approval submission failed without a confirmed transaction hash; broadcast status may be unknown. Check before retrying; provider details were withheld.");
  }
  let receiptStatus: "success" | "reverted";
  try {
    receiptStatus = await reader.waitForReceipt(hash);
  } catch {
    throw new OperatorApprovalError("Could not confirm the approval receipt; check this transaction hash before retrying.", hash);
  }
  if (receiptStatus !== "success") throw new OperatorApprovalError("Operator approval receipt indicates failure.", hash);

  let verifiedApproval: boolean;
  try {
    verifiedApproval = await reader.getOperatorApproval(wallet, context.adapter);
  } catch {
    throw new OperatorApprovalError("Receipt succeeded, but operator approval verification failed.", hash);
  }
  if (!verifiedApproval) throw new OperatorApprovalError("Receipt succeeded, but isApprovedForAll is still false.", hash);
  result.submitted = true;
  result.transactionHash = hash;
  return result;
}
