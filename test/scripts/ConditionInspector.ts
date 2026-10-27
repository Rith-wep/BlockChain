import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { keccak256, stringToHex, type Address, type Hex } from "viem";
import {
  CONDITION_INSPECTOR_CTF,
  CONDITION_INSPECTOR_ORACLE,
  createQuestionId,
  inspectBinaryCondition,
  interpretBinaryConditionStatus,
  saveConditionRecord,
  type BinaryConditionRecord,
} from "../../scripts/lib/condition-inspector.js";
import { loadIntegrationArtifacts, type IntegrationReader } from "../../scripts/lib/sepolia-integration-preflight.js";

const questionDescription = "Will the example event occur before the stated deadline?";
const nonce = "local-test-unique-nonce-001";
const questionId = createQuestionId(questionDescription, nonce);
const oracle = CONDITION_INSPECTOR_ORACLE;
const conditionId = `0x${"ab".repeat(32)}` as Hex;

describe("binary condition inspector", () => {
  it("derives a deterministic bytes32 ID from description, separator, and nonce", () => {
    assert.equal(
      createQuestionId(questionDescription, nonce),
      keccak256(stringToHex(`${questionDescription}|${nonce}`)),
    );
    assert.notEqual(createQuestionId(questionDescription, nonce), createQuestionId(questionDescription, `${nonce}-different`));
    assert.throws(() => createQuestionId(" ", nonce), /description cannot be empty/);
    assert.throws(() => createQuestionId(questionDescription, " "), /nonce cannot be empty/);
  });

  it("interprets an unprepared binary condition as not prepared and unresolved", () => {
    assert.deepEqual(interpretBinaryConditionStatus(0n, 0n), {
      prepared: false,
      resolved: false,
    });
  });

  it("interprets two slots with a zero denominator as prepared but unresolved", () => {
    assert.deepEqual(interpretBinaryConditionStatus(2n, 0n), {
      prepared: true,
      resolved: false,
    });
  });

  it("interprets a nonzero payout denominator as resolved", () => {
    assert.deepEqual(interpretBinaryConditionStatus(2n, 3n), {
      prepared: true,
      resolved: true,
    });
  });

  it("uses the official CTF read methods and binary outcome count", async () => {
    const artifacts = await loadIntegrationArtifacts();
    const calls: Array<{ functionName: string; address: Address; args?: readonly unknown[] }> = [];
    const reader: IntegrationReader = {
      getChainId: async () => 11155111,
      getCode: async () => "0x",
      readContract: async <T = unknown>(call): Promise<T> => {
        calls.push(call);
        const result = call.functionName === "getConditionId"
          ? conditionId
          : call.functionName === "getOutcomeSlotCount"
            ? 2n
            : 0n;
        return result as T;
      },
    };
    const status = await inspectBinaryCondition(reader, artifacts.ctf.abi, oracle, questionId);
    assert.equal(status.conditionId, conditionId);
    assert.equal(status.prepared, true);
    assert.equal(status.resolved, false);
    assert.deepEqual(calls.map(({ functionName }) => functionName).sort(), [
      "getConditionId",
      "getOutcomeSlotCount",
      "payoutDenominator",
    ].sort());
    assert.ok(calls.every((call) => call.address === CONDITION_INSPECTOR_CTF));
    assert.deepEqual(calls[0]?.args, [oracle, questionId, 2n]);
  });

  it("creates a record without overwriting an existing question ID record", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "ctf-condition-record-"));
    t.after(async () => rm(directory, { recursive: true, force: true }));
    const record: BinaryConditionRecord = {
      network: "sepolia",
      chainId: 11155111,
      ctfAddress: CONDITION_INSPECTOR_CTF,
      description: questionDescription,
      nonce,
      questionId,
      oracle,
      conditionId,
      outcomeSlotCount: "2",
      payoutDenominator: "0",
      prepared: true,
      resolved: false,
    };
    const path = await saveConditionRecord(record, directory);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), record);
    await assert.rejects(saveConditionRecord({ ...record, description: "different" }, directory), /already exists/);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), record);
  });
});
