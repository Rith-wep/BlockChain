import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address, Hex } from "viem";
import { INTEGRATION_ADDRESSES } from "../../scripts/lib/sepolia-integration-preflight.js";
import { SPLIT_AMOUNT, SPLIT_CONDITION_ID, SPLIT_QUESTION_ID, SPLIT_WALLET } from "../../scripts/lib/sepolia-binary-split.js";
import {
  OPERATOR_APPROVAL_CONFIRMATION,
  OperatorApprovalError,
  parseOperatorApprovalMode,
  runOperatorApproval,
  type OperatorApprovalReader,
} from "../../scripts/lib/sepolia-operator-approval.js";
import type { SavedPositionCondition } from "../../scripts/lib/sepolia-position-context.js";

const record: SavedPositionCondition = {
  ctfAddress: INTEGRATION_ADDRESSES.ctf,
  oracle: SPLIT_WALLET,
  questionId: SPLIT_QUESTION_ID,
  conditionId: SPLIT_CONDITION_ID,
};
const ctfRuntime = "0x6000" as Hex;
const collateralRuntime = "0x6001" as Hex;
const adapterRuntime = "0x6002" as Hex;
const txHash = `0x${"aa".repeat(32)}` as Hex;
const artifacts = { ctfRuntime, collateralRuntime, adapterRuntime, adapterImmutableReferences: [] };

function makeReader(overrides: Partial<OperatorApprovalReader> = {}) {
  let approved = false;
  let sent = 0;
  const calls: string[] = [];
  const reader: OperatorApprovalReader = {
    getChainId: async () => 11155111,
    getCode: async (address) => address === INTEGRATION_ADDRESSES.ctf ? ctfRuntime : address === INTEGRATION_ADDRESSES.collateral ? collateralRuntime : adapterRuntime,
    getAdapterCtf: async () => INTEGRATION_ADDRESSES.ctf,
    getAdapterCollateral: async () => INTEGRATION_ADDRESSES.collateral,
    getOfficialConditionId: async () => SPLIT_CONDITION_ID,
    getOutcomeSlotCount: async () => 2n,
    getPayoutDenominator: async () => 0n,
    getPositionIds: async () => ({ conditionId: SPLIT_CONDITION_ID, yesPositionId: 111n, noPositionId: 222n }),
    getPositionBalance: async () => SPLIT_AMOUNT,
    getOperatorApproval: async () => approved,
    simulateApproval: async (wallet, operator, enabled) => {
      calls.push("simulate");
      assert.equal(wallet, SPLIT_WALLET);
      assert.equal(operator, INTEGRATION_ADDRESSES.adapter);
      assert.equal(enabled, true);
    },
    estimateApproval: async () => { calls.push("estimate"); return 55_000n; },
    submitApproval: async (_wallet, operator, enabled) => {
      calls.push("setApprovalForAll");
      sent += 1;
      assert.equal(operator, INTEGRATION_ADDRESSES.adapter);
      assert.equal(enabled, true);
      approved = true;
      return txHash;
    },
    waitForReceipt: async () => "success",
    ...overrides,
  };
  return { reader, sent: () => sent, calls };
}

describe("guarded Sepolia CTF operator approval", () => {
  it("defaults to preflight and requires --submit for its independent transaction flow", () => {
    assert.equal(parseOperatorApprovalMode([]), "preflight");
    assert.equal(parseOperatorApprovalMode(["--submit"]), "submit");
    assert.throws(() => parseOperatorApprovalMode(["--merge"]), /read-only preflight/);
  });

  it("validates the original condition, all code, addresses, prepared status, and outcome ownership", async () => {
    const wrongChain = makeReader({ getChainId: async () => 1 });
    await assert.rejects(runOperatorApproval(SPLIT_WALLET, record, undefined, wrongChain.reader, artifacts), /expected Sepolia/);
    const wrongCode = makeReader({ getCode: async () => "0x" as Hex });
    await assert.rejects(runOperatorApproval(SPLIT_WALLET, record, undefined, wrongCode.reader, artifacts), /has no code/);
    const wrongAdapter = makeReader({ getAdapterCtf: async () => INTEGRATION_ADDRESSES.adapter });
    await assert.rejects(runOperatorApproval(SPLIT_WALLET, record, undefined, wrongAdapter.reader, artifacts), /does not match/);
    await assert.rejects(runOperatorApproval(SPLIT_WALLET, { ...record, questionId: `0x${"00".repeat(32)}` as Hex }, undefined, makeReader().reader, artifacts), /Saved condition record/);
    await assert.rejects(runOperatorApproval(SPLIT_WALLET, record, undefined, makeReader({ getOutcomeSlotCount: async () => 0n }).reader, artifacts), /not prepared as binary/);
    await assert.rejects(runOperatorApproval(SPLIT_WALLET, record, undefined, makeReader({ getPositionBalance: async (_wallet, id) => id === 111n ? SPLIT_AMOUNT - 1n : SPLIT_AMOUNT }).reader, artifacts), /at least 1 YES and 1 NO/);
  });

  it("simulates and estimates the exact setApprovalForAll without sending by default", async () => {
    const state = makeReader();
    let summary: { yesBalance: bigint; noBalance: bigint } | undefined;
    const result = await runOperatorApproval(SPLIT_WALLET, record, undefined, state.reader, artifacts, (value) => { summary = value; });
    assert.equal(result.submitted, false);
    assert.equal(result.gasEstimate, 55_000n);
    assert.equal(summary?.yesBalance, SPLIT_AMOUNT);
    assert.deepEqual(state.calls, ["simulate", "estimate"]);
    assert.equal(state.sent(), 0);
  });

  it("does not ask for a write when operator approval is already enabled", async () => {
    const state = makeReader({ getOperatorApproval: async () => true });
    const result = await runOperatorApproval(SPLIT_WALLET, record, async () => "must not be asked", state.reader, artifacts);
    assert.equal(result.alreadyApproved, true);
    assert.equal(state.calls.length, 0);
    assert.equal(state.sent(), 0);
  });

  it("shows checks before confirmation and rejects an incorrect phrase", async () => {
    const state = makeReader();
    let shown = false;
    await assert.rejects(runOperatorApproval(
      SPLIT_WALLET, record,
      async () => { assert.equal(shown, true); return "YES"; },
      state.reader, artifacts, () => { shown = true; },
    ), /Exact required phrase/);
    assert.equal(state.sent(), 0);
  });

  it("submits only setApprovalForAll after confirmation, waits, and verifies true", async () => {
    const state = makeReader();
    const result = await runOperatorApproval(SPLIT_WALLET, record, async () => OPERATOR_APPROVAL_CONFIRMATION, state.reader, artifacts);
    assert.equal(state.sent(), 1);
    assert.deepEqual(state.calls, ["simulate", "estimate", "simulate", "setApprovalForAll"]);
    assert.equal(result.submitted, true);
    assert.equal(result.transactionHash, txHash);
  });

  it("preserves the transaction hash when receipt or approval verification fails", async () => {
    const reverted = makeReader({ waitForReceipt: async () => "reverted" });
    await assert.rejects(runOperatorApproval(SPLIT_WALLET, record, async () => OPERATOR_APPROVAL_CONFIRMATION, reverted.reader, artifacts), (error: unknown) => {
      assert.ok(error instanceof OperatorApprovalError);
      assert.equal(error.transactionHash, txHash);
      return true;
    });
    const unverifiable = makeReader({ submitApproval: async () => txHash, getOperatorApproval: async () => false });
    await assert.rejects(runOperatorApproval(SPLIT_WALLET, record, async () => OPERATOR_APPROVAL_CONFIRMATION, unverifiable.reader, artifacts), (error: unknown) => {
      assert.ok(error instanceof OperatorApprovalError);
      assert.equal(error.transactionHash, txHash);
      return true;
    });
  });
});
