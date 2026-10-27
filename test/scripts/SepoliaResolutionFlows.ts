import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address, Hex } from "viem";
import { INTEGRATION_ADDRESSES } from "../../scripts/lib/sepolia-integration-preflight.js";
import { SPLIT_AMOUNT, SPLIT_CONDITION_ID, SPLIT_QUESTION_ID, SPLIT_WALLET } from "../../scripts/lib/sepolia-binary-split.js";
import {
  assertPayoutOracleSigner, PAYOUT_CONFIRMATION, PayoutReportError, parsePayoutMode, runPayoutReport, safePayoutErrorDiagnostic,
  type PayoutReader,
} from "../../scripts/lib/sepolia-payout-report.js";
import {
  REDEEM_CONFIRMATION, RedemptionError, parseRedemptionMode, runBinaryRedemption, type RedemptionReader,
} from "../../scripts/lib/sepolia-binary-redemption.js";
import type { ResolutionArtifacts, ResolutionRecord } from "../../scripts/lib/sepolia-resolution-context.js";

const record: ResolutionRecord = { ctfAddress: INTEGRATION_ADDRESSES.ctf, oracle: SPLIT_WALLET, questionId: SPLIT_QUESTION_ID, conditionId: SPLIT_CONDITION_ID };
const ctfRuntime = "0x6000" as Hex;
const collateralRuntime = "0x6001" as Hex;
const adapterRuntime = "0x6002" as Hex;
const artifacts: ResolutionArtifacts = { ctfRuntime, collateralRuntime, adapterRuntime, adapterImmutableReferences: [] };
const txHash = `0x${"cd".repeat(32)}` as Hex;

function makeReader(overrides: Partial<PayoutReader & RedemptionReader> = {}) {
  let denominator = 0n;
  let yesNumerator = 0n;
  let noNumerator = 0n;
  let yesBalance = SPLIT_AMOUNT;
  let noBalance = SPLIT_AMOUNT;
  let collateralBalance = 7n * SPLIT_AMOUNT;
  let approved = true;
  let sentReport = 0;
  let sentRedeem = 0;
  const calls: string[] = [];
  const base = {
    getChainId: async () => 11155111,
    getCode: async (address: Address) => address === INTEGRATION_ADDRESSES.ctf ? ctfRuntime : address === INTEGRATION_ADDRESSES.collateral ? collateralRuntime : adapterRuntime,
    getAdapterCtf: async () => INTEGRATION_ADDRESSES.ctf,
    getAdapterCollateral: async () => INTEGRATION_ADDRESSES.collateral,
    getOfficialConditionId: async () => SPLIT_CONDITION_ID,
    getOutcomeSlotCount: async () => 2n,
    getPayoutDenominator: async () => denominator,
    getPayoutNumerator: async (_id: Hex, index: bigint) => index === 0n ? yesNumerator : noNumerator,
    getPositionIds: async () => ({ conditionId: SPLIT_CONDITION_ID, yesPositionId: 11n, noPositionId: 22n }),
    getCollateralBalance: async () => collateralBalance,
    getPositionBalance: async (_wallet: Address, id: bigint) => id === 11n ? yesBalance : noBalance,
    getOperatorApproval: async () => approved,
    simulateReport: async (_oracle: Address, _qid: Hex, values: readonly [bigint, bigint]) => { calls.push("simulateReport"); if (denominator !== 0n || values[0] + values[1] === 0n) throw Error("invalid"); },
    estimateReport: async () => { calls.push("estimateReport"); return 88_000n; },
    submitReport: async (_oracle: Address, _qid: Hex, values: readonly [bigint, bigint]) => {
      calls.push("reportPayouts"); sentReport += 1; yesNumerator = values[0]; noNumerator = values[1]; denominator = values[0] + values[1]; return txHash;
    },
    waitForReceipt: async () => "success" as const,
    simulateRedeem: async () => {
      calls.push("simulateRedeem");
      if (denominator === 0n || !approved || (yesBalance === 0n && noBalance === 0n)) throw Error("not redeemable");
      return yesBalance * yesNumerator / denominator + noBalance * noNumerator / denominator;
    },
    estimateRedeem: async () => { calls.push("estimateRedeem"); return 155_000n; },
    submitRedeem: async () => {
      calls.push("redeemBinary"); sentRedeem += 1;
      collateralBalance += yesBalance * yesNumerator / denominator + noBalance * noNumerator / denominator;
      yesBalance = 0n; noBalance = 0n; return txHash;
    },
  };
  const reader = { ...base, ...overrides } as PayoutReader & RedemptionReader;
  return {
    reader, calls,
    sentReport: () => sentReport, sentRedeem: () => sentRedeem,
    setCondition: (d: bigint, y: bigint, n: bigint) => { denominator = d; yesNumerator = y; noNumerator = n; },
    setBalances: (y: bigint, n: bigint, c = collateralBalance) => { yesBalance = y; noBalance = n; collateralBalance = c; },
    setApproval: (v: boolean) => { approved = v; },
  };
}

describe("guarded Sepolia payout reporting", () => {
  it("requires an explicit two-number payout vector and keeps preflight separate", () => {
    assert.deepEqual(parsePayoutMode(["--payouts", "1,0"]), { mode: "preflight", payouts: [1n, 0n] });
    assert.deepEqual(parsePayoutMode(["--payouts", "YES,NO"]), { mode: "preflight", payouts: [1n, 0n] });
    assert.deepEqual(parsePayoutMode(["--payouts", "NO,YES"]), { mode: "preflight", payouts: [0n, 1n] });
    assert.deepEqual(parsePayoutMode(["--payouts", "0,1", "--submit"]), { mode: "submit", payouts: [0n, 1n] });
    assert.throws(() => parsePayoutMode([]), /Provide two comma-separated/);
    assert.throws(() => parsePayoutMode(["--payouts", "0,0"]), /non-zero/);
    assert.throws(() => parsePayoutMode(["--payouts", "1,maybe"]), /two comma-separated/);
  });

  it("reports sanitized Viem revert causes and ordinary JavaScript errors", () => {
    const cause = Object.assign(new Error("execution reverted: condition already prepared; https://rpc.example/path?apiKey=private"), { name: "ContractFunctionRevertedError" });
    const viemError = Object.assign(new Error("contract call failed"), { name: "ContractFunctionExecutionError", cause });
    const diagnostic = safePayoutErrorDiagnostic(viemError);
    assert.match(diagnostic, /contract simulation reverted/);
    assert.match(diagnostic, /ContractFunctionRevertedError/);
    assert.match(diagnostic, /\[redacted endpoint\]/);
    assert.doesNotMatch(diagnostic, /rpc\.example|apiKey=private/);
    assert.match(safePayoutErrorDiagnostic(new TypeError("invalid argument")), /JavaScript validation\/runtime error; cause TypeError/);
  });

  it("checks authorized oracle identity and condition / position preconditions", async () => {
    assert.doesNotThrow(() => assertPayoutOracleSigner(SPLIT_WALLET, SPLIT_WALLET));
    assert.throws(() => assertPayoutOracleSigner(INTEGRATION_ADDRESSES.adapter, SPLIT_WALLET), /not the authorized oracle/);
    const alreadyResolved = makeReader(); alreadyResolved.setCondition(1n, 1n, 0n);
    await assert.rejects(runPayoutReport(SPLIT_WALLET, record, [1n, 0n], undefined, alreadyResolved.reader, artifacts), /already resolved/);
    const noPositions = makeReader(); noPositions.setBalances(0n, 0n);
    await assert.rejects(runPayoutReport(SPLIT_WALLET, record, [1n, 0n], undefined, noPositions.reader, artifacts), /split 1 MOCK again/);
    const wrongChain = makeReader({ getChainId: async () => 1 });
    await assert.rejects(runPayoutReport(SPLIT_WALLET, record, [1n, 0n], undefined, wrongChain.reader, artifacts), /expected Sepolia/);
  });

  it("simulates and estimates without transaction sender by default", async () => {
    const state = makeReader();
    const result = await runPayoutReport(SPLIT_WALLET, record, [1n, 0n], undefined, state.reader, artifacts);
    assert.equal(result.submitted, false);
    assert.equal(result.gasEstimate, 88_000n);
    assert.deepEqual(state.calls.slice(-2), ["simulateReport", "estimateReport"]);
    assert.equal(state.sentReport(), 0);
  });

  it("retains a useful sanitized cause for read-only simulation failures", async () => {
    const viemRevert = Object.assign(new Error("execution failed"), {
      name: "ContractFunctionExecutionError",
      cause: Object.assign(new Error("execution reverted: https://rpc.example/v2/private-key"), { name: "ContractFunctionRevertedError" }),
    });
    const state = makeReader({ simulateReport: async () => { throw viemRevert; } });
    await assert.rejects(runPayoutReport(SPLIT_WALLET, record, [1n, 0n], undefined, state.reader, artifacts), (error: unknown) => {
      assert.ok(error instanceof PayoutReportError);
      assert.match(error.message, /contract simulation reverted/);
      assert.match(error.message, /ContractFunctionRevertedError/);
      assert.doesNotMatch(error.message, /rpc\.example|private-key/);
      return true;
    });
    assert.equal(state.sentReport(), 0);
  });

  it("does not send unless exact separate confirmation is supplied", async () => {
    const state = makeReader();
    await assert.rejects(runPayoutReport(SPLIT_WALLET, record, [1n, 0n], async () => "no", state.reader, artifacts), /Exact required phrase/);
    assert.equal(state.sentReport(), 0);
    assert.equal(PAYOUT_CONFIRMATION, "I_UNDERSTAND_PAYOUT_REPORTING_IS_IRREVERSIBLE_ON_SEPOLIA");
  });

  it("reports payouts once and verifies receipt, payout values, and unchanged positions", async () => {
    const state = makeReader();
    const result = await runPayoutReport(SPLIT_WALLET, record, [1n, 0n], async () => PAYOUT_CONFIRMATION, state.reader, artifacts);
    assert.equal(state.sentReport(), 1);
    assert.equal(result.transactionHash, txHash);
    assert.equal(result.submitted, true);
    assert.deepEqual(state.calls.slice(-2), ["simulateReport", "reportPayouts"]); // final simulation precedes the write
  });

  it("preserves transaction hash for reverted receipt or payout-state mismatch", async () => {
    const reverted = makeReader({ waitForReceipt: async () => "reverted" });
    await assert.rejects(runPayoutReport(SPLIT_WALLET, record, [1n, 0n], async () => PAYOUT_CONFIRMATION, reverted.reader, artifacts), (e: unknown) => e instanceof PayoutReportError && e.transactionHash === txHash);
    const mismatch = makeReader({ submitReport: async () => txHash });
    await assert.rejects(runPayoutReport(SPLIT_WALLET, record, [1n, 0n], async () => PAYOUT_CONFIRMATION, mismatch.reader, artifacts), (e: unknown) => e instanceof PayoutReportError && e.transactionHash === txHash && /payout values/.test(e.message));
  });

  it("preserves the hash when positions unexpectedly change after payout reporting", async () => {
    let reads = 0;
    const changedPositions = makeReader({
      getPositionBalance: async () => { reads += 1; return reads <= 4 ? SPLIT_AMOUNT : SPLIT_AMOUNT - 1n; },
    });
    await assert.rejects(
      runPayoutReport(SPLIT_WALLET, record, [1n, 0n], async () => PAYOUT_CONFIRMATION, changedPositions.reader, artifacts),
      (e: unknown) => e instanceof PayoutReportError && e.transactionHash === txHash && /balances differ/.test(e.message),
    );
  });
});

describe("guarded Sepolia redemption", () => {
  it("requires resolved condition, operator approval, and a held winning position", async () => {
    const unresolved = makeReader();
    await assert.rejects(runBinaryRedemption(SPLIT_WALLET, record, undefined, unresolved.reader, artifacts), /unresolved/);
    const noApproval = makeReader(); noApproval.setCondition(1n, 1n, 0n); noApproval.setApproval(false);
    await assert.rejects(runBinaryRedemption(SPLIT_WALLET, record, undefined, noApproval.reader, artifacts), /operator approval/);
    const noWinner = makeReader(); noWinner.setCondition(1n, 1n, 0n); noWinner.setBalances(0n, SPLIT_AMOUNT);
    await assert.rejects(runBinaryRedemption(SPLIT_WALLET, record, undefined, noWinner.reader, artifacts), /non-zero payout/);
  });

  it("simulates adapter redemption and estimates gas without sending", async () => {
    const state = makeReader(); state.setCondition(1n, 1n, 0n);
    const result = await runBinaryRedemption(SPLIT_WALLET, record, undefined, state.reader, artifacts);
    assert.equal(result.expectedPayout, SPLIT_AMOUNT);
    assert.equal(result.gasEstimate, 155_000n);
    assert.equal(result.submitted, false);
    assert.equal(state.sentRedeem(), 0);
  });

  it("requires independent confirmation and does not send on cancellation", async () => {
    const state = makeReader(); state.setCondition(1n, 1n, 0n);
    await assert.rejects(runBinaryRedemption(SPLIT_WALLET, record, async () => "no", state.reader, artifacts), /Exact required phrase/);
    assert.equal(state.sentRedeem(), 0);
    assert.equal(parseRedemptionMode([]), "preflight");
    assert.equal(parseRedemptionMode(["--submit"]), "submit");
    assert.throws(() => parseRedemptionMode(["--report"]), /read-only redemption/);
  });

  it("redeems and verifies payout and consumed positions after a successful receipt", async () => {
    const state = makeReader(); state.setCondition(1n, 1n, 0n);
    const result = await runBinaryRedemption(SPLIT_WALLET, record, async () => REDEEM_CONFIRMATION, state.reader, artifacts);
    assert.equal(state.sentRedeem(), 1);
    assert.equal(result.submitted, true);
    assert.equal(result.transactionHash, txHash);
    assert.equal(result.yesBalanceAfter, 0n);
    assert.equal(result.noBalanceAfter, 0n);
    assert.equal(result.collateralBalanceAfter, 8n * SPLIT_AMOUNT);
  });

  it("preserves transaction hash when receipt or post-transaction checks fail", async () => {
    const reverted = makeReader({ waitForReceipt: async () => "reverted" }); reverted.setCondition(1n, 1n, 0n);
    await assert.rejects(runBinaryRedemption(SPLIT_WALLET, record, async () => REDEEM_CONFIRMATION, reverted.reader, artifacts), (e: unknown) => e instanceof RedemptionError && e.transactionHash === txHash);
    const mismatch = makeReader({ submitRedeem: async () => txHash }); mismatch.setCondition(1n, 1n, 0n);
    await assert.rejects(runBinaryRedemption(SPLIT_WALLET, record, async () => REDEEM_CONFIRMATION, mismatch.reader, artifacts), (e: unknown) => e instanceof RedemptionError && e.transactionHash === txHash && /balances differ/.test(e.message));
  });
});
