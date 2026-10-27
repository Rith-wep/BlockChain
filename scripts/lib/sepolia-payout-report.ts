import type { Address, Hex } from "viem";
import { SPLIT_AMOUNT, SPLIT_WALLET } from "./sepolia-binary-split.js";
import {
  readResolutionContext,
  type ResolutionArtifacts,
  type ResolutionContext,
  type ResolutionReader,
  type ResolutionRecord,
} from "./sepolia-resolution-context.js";

export const PAYOUT_CONFIRMATION = "I_UNDERSTAND_PAYOUT_REPORTING_IS_IRREVERSIBLE_ON_SEPOLIA";
export function assertPayoutOracleSigner(signer: Address, oracle: Address): void {
  if (signer.toLowerCase() !== oracle.toLowerCase()) throw new PayoutReportError("Signer is not the authorized oracle; no payout report was sent.");
}

export function parsePayoutMode(args: readonly string[]): { mode: "preflight" | "submit"; payouts: readonly [bigint, bigint] } {
  let submit = false;
  let payoutText: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--submit" && !submit) submit = true;
    else if (args[i] === "--payouts" && payoutText === undefined && args[i + 1]) payoutText = args[++i];
    else throw new Error("Use --payouts <YES,NO> or two numeric payout values for read-only simulation; add --submit only for separately confirmed reporting.");
  }
  if (!payoutText || !/^(?:YES|NO|\d+),(?:YES|NO|\d+)$/i.test(payoutText)) {
    throw new Error("Provide two comma-separated values: YES/NO labels or non-negative integer payout weights.");
  }
  const parseValue = (value: string): bigint => {
    if (value.toUpperCase() === "YES") return 1n;
    if (value.toUpperCase() === "NO") return 0n;
    return BigInt(value);
  };
  const [yes, no] = payoutText.split(",").map(parseValue);
  const maxUint256 = (1n << 256n) - 1n;
  if (yes > maxUint256 || no > maxUint256) throw new Error("Each payout value must fit uint256.");
  if (yes + no === 0n) throw new Error("Payout vector must contain at least one non-zero value.");
  return { mode: submit ? "submit" : "preflight", payouts: [yes, no] };
}

export type PayoutReader = ResolutionReader & {
  simulateReport(oracle: Address, questionId: Hex, payouts: readonly [bigint, bigint]): Promise<void>;
  estimateReport(oracle: Address, questionId: Hex, payouts: readonly [bigint, bigint]): Promise<bigint>;
  submitReport?: (oracle: Address, questionId: Hex, payouts: readonly [bigint, bigint]) => Promise<Hex>;
  waitForReceipt?: (hash: Hex) => Promise<"success" | "reverted">;
};

export type PayoutResult = {
  context: ResolutionContext;
  payouts: readonly [bigint, bigint];
  gasEstimate: bigint;
  submitted: boolean;
  transactionHash?: Hex;
};

export class PayoutReportError extends Error {
  constructor(message: string, readonly transactionHash?: Hex) { super(message); this.name = "PayoutReportError"; }
}

function errorChain(error: unknown): Error[] {
  const chain: Error[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current !== undefined; depth += 1) {
    if (current instanceof Error) {
      chain.push(current);
      current = "cause" in current ? current.cause : undefined;
    } else {
      const name = typeof current === "object" && current !== null && "name" in current ? String(current.name) : "UnknownError";
      const message = typeof current === "object" && current !== null && "message" in current ? String(current.message) : String(current);
      chain.push(Object.assign(new Error(message), { name }));
      current = typeof current === "object" && current !== null && "cause" in current ? current.cause : undefined;
    }
  }
  return chain;
}

function safeErrorText(message: string): string {
  const sanitized = message
    .replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, "[redacted endpoint]")
    .replace(/(api[_-]?key|access[_-]?token|private[_-]?key|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/(api key|access token|private key|seed phrase|rpc url)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\b0x[0-9a-f]{64}\b/gi, "[redacted hex value]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return sanitized.slice(0, 180) || "details withheld";
}

/** Returns error class/category and a short sanitized nested cause; never includes raw provider objects. */
export function safePayoutErrorDiagnostic(error: unknown): string {
  const chain = errorChain(error);
  const names = chain.map(({ name }) => name);
  const reverted = names.some((name) => /(?:ContractFunction)?Reverted|ExecutionReverted/i.test(name));
  const category = reverted
    ? "contract simulation reverted"
    : names.some((name) => /ContractFunctionExecutionError/i.test(name))
      ? "contract simulation execution error"
      : names.some((name) => /Timeout|Abort/i.test(name))
        ? "RPC request timeout"
        : names.some((name) => /HttpRequest|RpcRequest|Transport/i.test(name))
          ? "RPC transport/provider error"
          : names.some((name) => /SyntaxError|TypeError|RangeError/i.test(name))
            ? "JavaScript validation/runtime error"
            : "JavaScript or provider error";
  const detail = chain.at(-1) ?? chain[0];
  if (!detail) return `${category}; cause unavailable`;
  const safeName = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(detail.name) ? detail.name : "UnknownError";
  return `${category}; cause ${safeName}: ${safeErrorText(detail.message)}`;
}

function fail(message: string): never { throw new PayoutReportError(message); }

async function readContext(wallet: Address, record: ResolutionRecord, reader: PayoutReader, artifacts: ResolutionArtifacts): Promise<ResolutionContext> {
  try { return await readResolutionContext(wallet, record, reader, artifacts); }
  catch (error) {
    if (error instanceof Error && error.name === "ResolutionContextError") fail(error.message);
    fail("Payout preflight read failed; provider details were withheld.");
  }
}

export async function runPayoutReport(
  wallet: Address,
  record: ResolutionRecord,
  payouts: readonly [bigint, bigint],
  requestConfirmation: (() => Promise<string>) | undefined,
  reader: PayoutReader,
  artifacts: ResolutionArtifacts,
  onPreflight?: (result: PayoutResult) => void,
): Promise<PayoutResult> {
  if (payouts[0] < 0n || payouts[1] < 0n || payouts[0] + payouts[1] === 0n) fail("Payout vector must contain two non-negative values and a non-zero total.");
  let context = await readContext(wallet, record, reader, artifacts);
  if (context.payoutDenominator !== 0n) fail("Condition is already resolved; payout reporting cannot be repeated.");
  if (context.yesBalance < SPLIT_AMOUNT || context.noBalance < SPLIT_AMOUNT) {
    fail("Wallet must hold at least 1 YES and 1 NO before resolving; split 1 MOCK again while the condition is unresolved.");
  }
  try { await reader.simulateReport(context.oracle, context.questionId, payouts); }
  catch (error) { fail(`Official CTF payout-report simulation failed (${safePayoutErrorDiagnostic(error)}); no transaction was sent and sensitive details were withheld.`); }
  let gasEstimate: bigint;
  try { gasEstimate = await reader.estimateReport(context.oracle, context.questionId, payouts); }
  catch (error) { fail(`Payout-report gas estimate failed (${safePayoutErrorDiagnostic(error)}); no transaction was sent and sensitive details were withheld.`); }
  const result: PayoutResult = { context, payouts, gasEstimate, submitted: false };
  onPreflight?.(result);
  if (!requestConfirmation) return result;
  let phrase: string;
  try { phrase = await requestConfirmation(); } catch { fail("Confirmation input failed; no payout report was sent."); }
  if (phrase !== PAYOUT_CONFIRMATION) fail(`Confirmation did not match. Exact required phrase: ${PAYOUT_CONFIRMATION}`);
  if (!reader.submitReport || !reader.waitForReceipt) fail("Confirmed payout reporting requested but no transaction sender is configured.");

  context = await readContext(wallet, record, reader, artifacts);
  if (context.payoutDenominator !== 0n || context.yesBalance < SPLIT_AMOUNT || context.noBalance < SPLIT_AMOUNT) {
    fail("Condition or position balances changed after review; no payout was reported.");
  }
  try { await reader.simulateReport(context.oracle, context.questionId, payouts); }
  catch (error) { fail(`Final payout simulation failed (${safePayoutErrorDiagnostic(error)}); no transaction was sent and sensitive details were withheld.`); }
  let hash: Hex;
  try { hash = await reader.submitReport(context.oracle, context.questionId, payouts); }
  catch (error) {
    if (error instanceof PayoutReportError) throw error;
    fail("Payout-report submission failed without a confirmed transaction hash; broadcast status may be unknown. Check before retrying; provider details were withheld.");
  }
  try {
    const status = await reader.waitForReceipt(hash);
    if (status !== "success") throw new Error();
  } catch { throw new PayoutReportError("Payout-report receipt failed or could not be confirmed.", hash); }
  let denominator: bigint;
  let yesNumerator: bigint;
  let noNumerator: bigint;
  try {
    [denominator, yesNumerator, noNumerator] = await Promise.all([
      reader.getPayoutDenominator(context.conditionId),
      reader.getPayoutNumerator(context.conditionId, 0n),
      reader.getPayoutNumerator(context.conditionId, 1n),
    ]);
  } catch { throw new PayoutReportError("Receipt succeeded, but payout state verification failed.", hash); }
  if (denominator !== payouts[0] + payouts[1] || yesNumerator !== payouts[0] || noNumerator !== payouts[1]) {
    throw new PayoutReportError("Receipt succeeded, but on-chain payout values do not match the submitted vector.", hash);
  }
  let after: ResolutionContext;
  try { after = await readContext(wallet, record, reader, artifacts); }
  catch { throw new PayoutReportError("Receipt succeeded, but post-report balance verification failed.", hash); }
  if (after.yesBalance !== context.yesBalance || after.noBalance !== context.noBalance ||
      after.collateralBalance !== context.collateralBalance || after.payoutDenominator !== denominator) {
    throw new PayoutReportError("Payout report succeeded, but condition or wallet balances differ from expected post-report state.", hash);
  }
  result.submitted = true;
  result.transactionHash = hash;
  return result;
}

