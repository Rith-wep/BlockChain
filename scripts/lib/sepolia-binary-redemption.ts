import type { Address, Hex } from "viem";
import {
  readResolutionContext,
  type ResolutionArtifacts,
  type ResolutionContext,
  type ResolutionReader,
  type ResolutionRecord,
} from "./sepolia-resolution-context.js";

export const REDEEM_CONFIRMATION = "I_CONFIRM_REDEEM_ALL_ELIGIBLE_POSITIONS_ON_SEPOLIA";
export function parseRedemptionMode(args: readonly string[]): "preflight" | "submit" {
  if (args.length === 0) return "preflight";
  if (args.length === 1 && args[0] === "--submit") return "submit";
  throw new Error("Use no arguments for read-only redemption simulation, or --submit for the separately confirmed redemption flow.");
}

export type RedemptionReader = ResolutionReader & {
  simulateRedeem(wallet: Address, oracle: Address, questionId: Hex): Promise<bigint>;
  estimateRedeem(wallet: Address, oracle: Address, questionId: Hex): Promise<bigint>;
  submitRedeem?: (wallet: Address, oracle: Address, questionId: Hex) => Promise<Hex>;
  waitForReceipt?: (hash: Hex) => Promise<"success" | "reverted">;
};
export type RedemptionResult = {
  context: ResolutionContext;
  expectedPayout: bigint;
  gasEstimate: bigint;
  submitted: boolean;
  transactionHash?: Hex;
  yesBalanceAfter?: bigint;
  noBalanceAfter?: bigint;
  collateralBalanceAfter?: bigint;
};
export class RedemptionError extends Error {
  constructor(message: string, readonly transactionHash?: Hex) { super(message); this.name = "RedemptionError"; }
}
function fail(message: string): never { throw new RedemptionError(message); }
async function contextRead(wallet: Address, record: ResolutionRecord, reader: RedemptionReader, artifacts: ResolutionArtifacts): Promise<ResolutionContext> {
  try { return await readResolutionContext(wallet, record, reader, artifacts); }
  catch (error) {
    if (error instanceof Error && error.name === "ResolutionContextError") fail(error.message);
    fail("Redemption preflight read failed; provider details were withheld.");
  }
}
function calculatePayout(context: ResolutionContext): bigint {
  const denominator = context.payoutDenominator;
  if (denominator === 0n) fail("Condition is unresolved; positions cannot be redeemed yet.");
  if ((context.yesBalance === 0n && context.noBalance === 0n) ||
      (context.yesBalance > 0n && context.payoutNumerators[0] === 0n &&
       context.noBalance > 0n && context.payoutNumerators[1] === 0n)) {
    fail("Wallet has no eligible winning positions to redeem.");
  }
  if ((context.yesBalance > 0n && context.payoutNumerators[0] > 0n) ||
      (context.noBalance > 0n && context.payoutNumerators[1] > 0n)) {
    return context.yesBalance * context.payoutNumerators[0] / denominator +
      context.noBalance * context.payoutNumerators[1] / denominator;
  }
  fail("Wallet holds positions, but none has a non-zero payout numerator.");
}

export async function runBinaryRedemption(
  wallet: Address,
  record: ResolutionRecord,
  requestConfirmation: (() => Promise<string>) | undefined,
  reader: RedemptionReader,
  artifacts: ResolutionArtifacts,
  onPreflight?: (result: RedemptionResult) => void,
): Promise<RedemptionResult> {
  let context = await contextRead(wallet, record, reader, artifacts);
  if (!context.operatorApproved) fail("ERC-1155 operator approval for the adapter is not enabled.");
  const expectedPayout = calculatePayout(context);
  let simulatedPayout: bigint;
  try { simulatedPayout = await reader.simulateRedeem(wallet, context.oracle, context.questionId); }
  catch { fail("Exact adapter redemption simulation failed; no transaction was sent and provider details were withheld."); }
  if (simulatedPayout !== expectedPayout) fail("Adapter simulation payout differs from payout-numerator calculation; refusing to continue.");
  let gasEstimate: bigint;
  try { gasEstimate = await reader.estimateRedeem(wallet, context.oracle, context.questionId); }
  catch { fail("Redemption gas estimate failed; no transaction was sent and provider details were withheld."); }
  const result: RedemptionResult = { context, expectedPayout, gasEstimate, submitted: false };
  onPreflight?.(result);
  if (!requestConfirmation) return result;
  let phrase: string;
  try { phrase = await requestConfirmation(); } catch { fail("Confirmation input failed; no redemption was sent."); }
  if (phrase !== REDEEM_CONFIRMATION) fail(`Confirmation did not match. Exact required phrase: ${REDEEM_CONFIRMATION}`);
  if (!reader.submitRedeem || !reader.waitForReceipt) fail("Confirmed redemption requested but no transaction sender is configured.");

  context = await contextRead(wallet, record, reader, artifacts);
  if (!context.operatorApproved || calculatePayout(context) !== expectedPayout) fail("Condition, approval, or balances changed after review; rerun the preflight.");
  try {
    simulatedPayout = await reader.simulateRedeem(wallet, context.oracle, context.questionId);
    if (simulatedPayout !== expectedPayout) fail("Final redemption simulation payout changed; no transaction was sent.");
  } catch (error) {
    if (error instanceof RedemptionError) throw error;
    fail("Final redemption simulation failed; no transaction was sent and provider details were withheld.");
  }
  let hash: Hex;
  try { hash = await reader.submitRedeem(wallet, context.oracle, context.questionId); }
  catch (error) {
    if (error instanceof RedemptionError) throw error;
    fail("Redemption submission failed without a confirmed transaction hash; broadcast status may be unknown. Check before retrying; provider details were withheld.");
  }
  try {
    const status = await reader.waitForReceipt(hash);
    if (status !== "success") throw new Error();
  } catch { throw new RedemptionError("Redemption receipt failed or could not be confirmed.", hash); }
  let yesBalanceAfter: bigint;
  let noBalanceAfter: bigint;
  let collateralBalanceAfter: bigint;
  try {
    [yesBalanceAfter, noBalanceAfter, collateralBalanceAfter] = await Promise.all([
      reader.getPositionBalance(wallet, context.yesPositionId),
      reader.getPositionBalance(wallet, context.noPositionId),
      reader.getCollateralBalance(wallet),
    ]);
  } catch { throw new RedemptionError("Receipt succeeded, but post-redemption balance verification failed.", hash); }
  if (yesBalanceAfter !== 0n || noBalanceAfter !== 0n ||
      collateralBalanceAfter !== context.collateralBalance + expectedPayout) {
    throw new RedemptionError("Receipt succeeded, but wallet position or collateral balances differ from the expected redemption.", hash);
  }
  result.submitted = true;
  result.transactionHash = hash;
  result.yesBalanceAfter = yesBalanceAfter;
  result.noBalanceAfter = noBalanceAfter;
  result.collateralBalanceAfter = collateralBalanceAfter;
  return result;
}

