import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import type { Hex } from "viem";
import { CONDITION_RECORD_DIRECTORY, type BinaryConditionRecord } from "../../scripts/lib/condition-inspector.js";
import {
  EXPECTED_PREPARE_RECORD,
  PREPARE_CONDITION_CONFIRMATION,
  runConditionPreparation,
  validateSavedConditionRecord,
  type PreparationReader,
} from "../../scripts/lib/prepare-sepolia-condition.js";

async function loadRecord(): Promise<BinaryConditionRecord> {
  const recordPath = resolve(
    process.cwd(),
    CONDITION_RECORD_DIRECTORY,
    `${EXPECTED_PREPARE_RECORD.questionId.slice(2)}.json`,
  );
  return validateSavedConditionRecord(JSON.parse(await readFile(recordPath, "utf8")) as unknown);
}

function mockReader(overrides: Partial<PreparationReader> = {}) {
  let sends = 0;
  let simulations = 0;
  let prepared = false;
  const reader: PreparationReader = {
    getChainId: async () => 11155111,
    getCode: async () => "0x6000",
    getConditionId: async () => EXPECTED_PREPARE_RECORD.conditionId,
    getOutcomeSlotCount: async () => prepared ? 2n : 0n,
    getPayoutDenominator: async () => 0n,
    simulate: async () => { simulations += 1; },
    estimateGas: async () => 150_000n,
    submit: async () => { sends += 1; prepared = true; return `0x${"ab".repeat(32)}` as Hex; },
    waitForReceipt: async () => "success",
    ...overrides,
  };
  return { reader, sends: () => sends, simulations: () => simulations };
}

describe("Sepolia binary condition preparation guard", () => {
  it("rejects a record whose saved identifiers or question inputs are incorrect", async () => {
    const record = await loadRecord();
    assert.throws(
      () => validateSavedConditionRecord({ ...record, conditionId: `0x${"00".repeat(32)}` }),
      /does not match the approved/,
    );
    assert.throws(
      () => validateSavedConditionRecord({ ...record, description: "changed after ID generation" }),
      /do not reproduce/,
    );
    assert.throws(
      () => validateSavedConditionRecord({ ...record, ctfAddress: 42 }),
      /does not match the approved/,
    );
  });

  it("stops before simulation and sending when the condition is already prepared", async () => {
    const record = await loadRecord();
    const state = mockReader({ getOutcomeSlotCount: async () => 2n });
    await assert.rejects(
      runConditionPreparation(record, undefined, state.reader),
      /already prepared/,
    );
    assert.equal(state.simulations(), 0);
    assert.equal(state.sends(), 0);
  });

  it("runs simulation and gas estimation but never submits without the exact confirmation", async () => {
    const record = await loadRecord();
    const state = mockReader();
    const preflight = await runConditionPreparation(record, undefined, state.reader);
    assert.equal(preflight.submitted, false);
    assert.equal(preflight.gasEstimate, 150_000n);
    assert.equal(state.simulations(), 1);
    assert.equal(state.sends(), 0);

    await assert.rejects(
      runConditionPreparation(record, "YES_DEPLOY", state.reader),
      /Exact required phrase/,
    );
    assert.equal(state.sends(), 0);
  });

  it("accepts only the documented confirmation before invoking its injected sender", async () => {
    const record = await loadRecord();
    const state = mockReader();
    const result = await runConditionPreparation(
      record,
      PREPARE_CONDITION_CONFIRMATION,
      state.reader,
    );
    assert.equal(state.sends(), 1);
    assert.equal(result.submitted, true);
    assert.equal(result.transactionHash, `0x${"ab".repeat(32)}`);
  });
});
