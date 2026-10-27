import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address, Hex } from "viem";
import { INTEGRATION_ADDRESSES } from "../../scripts/lib/sepolia-integration-preflight.js";
import { SPLIT_AMOUNT, SPLIT_CONDITION_ID, SPLIT_QUESTION_ID, SPLIT_WALLET } from "../../scripts/lib/sepolia-binary-split.js";
import {
  BinaryMergeError,
  MERGE_CONFIRMATION,
  parseMergeMode,
  runBinaryMerge,
  type BinaryMergeReader,
} from "../../scripts/lib/sepolia-binary-merge.js";
import type { SavedPositionCondition } from "../../scripts/lib/sepolia-position-context.js";

const record: SavedPositionCondition = {
  ctfAddress: INTEGRATION_ADDRESSES.ctf,
  oracle: SPLIT_WALLET,
  questionId: SPLIT_QUESTION_ID,
  conditionId: SPLIT_CONDITION_ID,
};
const ctfRuntime = "0x6100" as Hex;
const collateralRuntime = "0x6101" as Hex;
const adapterRuntime = "0x6102" as Hex;
const txHash = `0x${"bc".repeat(32)}` as Hex;
const artifacts = { ctfRuntime, collateralRuntime, adapterRuntime, adapterImmutableReferences: [] };

function makeReader(overrides: Partial<BinaryMergeReader> = {}) {
  let yesBalance = 3n * SPLIT_AMOUNT;
  let noBalance = 4n * SPLIT_AMOUNT;
  let collateralBalance = 10n * SPLIT_AMOUNT;
  let sent = 0;
  const operations: string[] = [];
  const reader: BinaryMergeReader = {
    getChainId: async () => 11155111,
    getCode: async (address) => address === INTEGRATION_ADDRESSES.ctf ? ctfRuntime : address === INTEGRATION_ADDRESSES.collateral ? collateralRuntime : adapterRuntime,
    getAdapterCtf: async () => INTEGRATION_ADDRESSES.ctf,
    getAdapterCollateral: async () => INTEGRATION_ADDRESSES.collateral,
    getOfficialConditionId: async () => SPLIT_CONDITION_ID,
    getOutcomeSlotCount: async () => 2n,
    getPayoutDenominator: async () => 0n,
    getPositionIds: async () => ({ conditionId: SPLIT_CONDITION_ID, yesPositionId: 111n, noPositionId: 222n }),
    getOperatorApproval: async () => true,
    getPositionBalance: async (_wallet, id) => id === 111n ? yesBalance : noBalance,
    getCollateralBalance: async () => collateralBalance,
    simulateMerge: async (wallet, oracle, questionId, amount) => {
      operations.push("simulate");
      assert.equal(wallet, SPLIT_WALLET);
      assert.equal(oracle, SPLIT_WALLET);
      assert.equal(questionId, SPLIT_QUESTION_ID);
      assert.equal(amount, SPLIT_AMOUNT);
    },
    estimateMerge: async (_wallet, _oracle, questionId, amount) => {
      operations.push("estimate");
      assert.equal(questionId, SPLIT_QUESTION_ID);
      assert.equal(amount, SPLIT_AMOUNT);
      return 190_000n;
    },
    submitMerge: async (_wallet, _oracle, questionId, amount) => {
      operations.push("mergeBinary");
      sent += 1;
      assert.equal(questionId, SPLIT_QUESTION_ID);
      assert.equal(amount, SPLIT_AMOUNT);
      yesBalance -= amount;
      noBalance -= amount;
      collateralBalance += amount;
      return txHash;
    },
    waitForReceipt: async () => "success",
    ...overrides,
  };
  return { reader, sent: () => sent, operations };
}

async function run(reader: BinaryMergeReader, confirm?: () => Promise<string>, onPreflight?: (result: Awaited<ReturnType<typeof runBinaryMerge>>) => void) {
  return runBinaryMerge(SPLIT_WALLET, record, confirm, reader, artifacts, onPreflight);
}

describe("guarded Sepolia binary merge", () => {
  it("defaults to preflight and needs a separate --submit request", () => {
    assert.equal(parseMergeMode([]), "preflight");
    assert.equal(parseMergeMode(["--submit"]), "submit");
    assert.throws(() => parseMergeMode(["--approve"]), /read-only preflight/);
  });

  it("requires the original record, Sepolia contracts, prepared unresolved condition, and matching adapter", async () => {
    await assert.rejects(runBinaryMerge(SPLIT_WALLET, { ...record, conditionId: `0x${"00".repeat(32)}` as Hex }, undefined, makeReader().reader, artifacts), /Saved condition record/);
    await assert.rejects(run(makeReader({ getChainId: async () => 1 }).reader), /expected Sepolia/);
    await assert.rejects(run(makeReader({ getCode: async () => "0x" as Hex }).reader), /has no code/);
    await assert.rejects(run(makeReader({ getAdapterCollateral: async () => `0x${"12".repeat(20)}` as Address }).reader), /does not match/);
    await assert.rejects(run(makeReader({ getOutcomeSlotCount: async () => 0n }).reader), /not prepared as binary/);
    await assert.rejects(run(makeReader({ getPayoutDenominator: async () => 1n }).reader), /resolved/);
  });

  it("requires operator approval and at least one YES and NO position", async () => {
    await assert.rejects(run(makeReader({ getOperatorApproval: async () => false }).reader), /operator approval.*not enabled/);
    await assert.rejects(run(makeReader({ getPositionBalance: async (_wallet, id) => id === 111n ? SPLIT_AMOUNT : SPLIT_AMOUNT - 1n }).reader), /at least 1 YES and 1 NO/);
  });

  it("simulates the exact 1 MOCK merge and estimates gas without sending by default", async () => {
    const state = makeReader();
    let shown: Awaited<ReturnType<typeof run>> | undefined;
    const result = await run(state.reader, undefined, (summary) => { shown = summary; });
    assert.equal(result.submitted, false);
    assert.equal(result.gasEstimate, 190_000n);
    assert.equal(result.context.conditionId, SPLIT_CONDITION_ID);
    assert.equal(shown?.yesBalanceBefore, 3n * SPLIT_AMOUNT);
    assert.deepEqual(state.operations, ["simulate", "estimate"]);
    assert.equal(state.sent(), 0);
  });

  it("shows preflight results before the separate merge confirmation", async () => {
    const state = makeReader();
    let shown = false;
    await assert.rejects(run(state.reader, async () => {
      assert.equal(shown, true);
      return "MERGE";
    }, () => { shown = true; }), /Exact required phrase/);
    assert.equal(state.sent(), 0);
  });

  it("submits only mergeBinary and verifies exact position and collateral balance changes", async () => {
    const state = makeReader();
    const result = await run(state.reader, async () => MERGE_CONFIRMATION);
    assert.equal(state.sent(), 1);
    assert.deepEqual(state.operations, ["simulate", "estimate", "simulate", "mergeBinary"]);
    assert.equal(result.submitted, true);
    assert.equal(result.transactionHash, txHash);
    assert.equal(result.yesBalanceAfter, 2n * SPLIT_AMOUNT);
    assert.equal(result.noBalanceAfter, 3n * SPLIT_AMOUNT);
    assert.equal(result.collateralBalanceAfter, 11n * SPLIT_AMOUNT);
  });

  it("preserves the transaction hash for receipt failure and incorrect post-merge balances", async () => {
    await assert.rejects(run(makeReader({ waitForReceipt: async () => "reverted" }).reader, async () => MERGE_CONFIRMATION), (error: unknown) => {
      assert.ok(error instanceof BinaryMergeError);
      assert.equal(error.transactionHash, txHash);
      return true;
    });
    await assert.rejects(run(makeReader({ submitMerge: async () => txHash }).reader, async () => MERGE_CONFIRMATION), (error: unknown) => {
      assert.ok(error instanceof BinaryMergeError);
      assert.equal(error.transactionHash, txHash);
      assert.match(error.message, /did not change by exactly/);
      return true;
    });
  });

  it("redacts provider details from state-read errors", async () => {
    await assert.rejects(run(makeReader({ getChainId: async () => { throw new Error("https://rpc.invalid/?key=secret"); } }).reader), (error: unknown) => {
      assert.ok(error instanceof BinaryMergeError);
      assert.doesNotMatch(error.message, /rpc\.invalid|secret/);
      return true;
    });
  });
});
