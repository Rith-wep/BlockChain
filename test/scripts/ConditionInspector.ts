import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { keccak256, stringToHex, type Address, type Hex } from "viem";
import {
  CONDITION_INSPECTOR_CTF,
  CONDITION_INSPECTOR_ORACLE,
  createQuestionId,
  inspectBinaryCondition,
  interpretBinaryConditionStatus,
  loadConditionRecord,
  parseConditionInspectorCommand,
  saveConditionRecord,
  updateConditionRecordStatus,
  type BinaryConditionRecord,
} from "../../scripts/lib/condition-inspector.js";
import { loadIntegrationArtifacts, type IntegrationReader } from "../../scripts/lib/sepolia-integration-preflight.js";

const questionDescription = "Will the example event occur before the stated deadline?";
const nonce = "local-test-unique-nonce-001";
const questionId = createQuestionId(questionDescription, nonce);
const oracle = CONDITION_INSPECTOR_ORACLE;
const conditionId = `0x${"ab".repeat(32)}` as Hex;

describe("binary condition inspector", () => {
  it("requires an explicit inspect or create mode and reuses an exact question ID", () => {
    assert.deepEqual(parseConditionInspectorCommand(["--question-id", questionId]), {
      mode: "inspect-question-id",
      questionId,
    });
    assert.deepEqual(parseConditionInspectorCommand(["--record", "test-records/saved.json"]), {
      mode: "inspect-record",
      recordPath: "test-records/saved.json",
    });
    assert.deepEqual(parseConditionInspectorCommand(["--create", questionDescription]), {
      mode: "create",
      description: questionDescription,
    });
    assert.throws(() => parseConditionInspectorCommand([]), /Choose one explicit mode/);
    assert.throws(() => parseConditionInspectorCommand([questionDescription]), /Choose one explicit mode/);
    assert.throws(() => parseConditionInspectorCommand(["--question-id", "not-a-question-id"]), /Choose one explicit mode/);
  });

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

  it("loads and validates the original saved identity without generating a new question ID", async () => {
    const originalPath = resolve(
      process.cwd(),
      "test-records/ctf-conditions/73ab19f7f6dbc9776a16fb868152cc24c8a8bb377e5e8af87a96f29c54bf60be.json",
    );
    const record = await loadConditionRecord(originalPath);
    assert.equal(record.description, "Will the described event occur by the stated deadline?");
    assert.equal(record.nonce, "3f76b137-9388-45f2-beda-a303d4efedcf");
    assert.equal(record.questionId, "0x73ab19f7f6dbc9776a16fb868152cc24c8a8bb377e5e8af87a96f29c54bf60be");
    assert.equal(createQuestionId(record.description, record.nonce), record.questionId);
    const command = parseConditionInspectorCommand(["--question-id", record.questionId]);
    assert.equal(command.mode, "inspect-question-id");
    if (command.mode === "inspect-question-id") assert.equal(command.questionId, record.questionId);
  });

  it("rejects missing or internally inconsistent saved records", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "ctf-condition-invalid-record-"));
    t.after(async () => rm(directory, { recursive: true, force: true }));
    await assert.rejects(loadConditionRecord(join(directory, "missing.json")), /missing, unreadable/);

    const badPath = join(directory, "bad.json");
    await writeFile(badPath, JSON.stringify({
      network: "sepolia",
      chainId: 11155111,
      ctfAddress: CONDITION_INSPECTOR_CTF,
      oracle,
      description: "altered description does not match its question ID",
      nonce,
      questionId,
      conditionId,
    }));
    await assert.rejects(loadConditionRecord(badPath), /do not reproduce/);
  });

  it("updates only cached status after verified reads and preserves original identity", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "ctf-condition-status-update-"));
    t.after(async () => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "record.json");
    const record: BinaryConditionRecord = {
      network: "sepolia",
      chainId: 11155111,
      ctfAddress: CONDITION_INSPECTOR_CTF,
      description: questionDescription,
      nonce,
      questionId,
      oracle,
      conditionId,
      outcomeSlotCount: "0",
      payoutDenominator: "0",
      prepared: false,
      resolved: false,
    };
    await writeFile(path, JSON.stringify(record));
    const updated = await updateConditionRecordStatus(path, record, {
      conditionId,
      outcomeSlotCount: 2n,
      payoutDenominator: 0n,
      prepared: true,
      resolved: false,
    });
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), updated);
    assert.equal(updated.questionId, record.questionId);
    assert.equal(updated.nonce, record.nonce);
    assert.equal(updated.description, record.description);
    assert.equal(updated.prepared, true);
  });
});
