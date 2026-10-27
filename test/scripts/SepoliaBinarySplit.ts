import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address, Hex } from "viem";
import { INTEGRATION_ADDRESSES } from "../../scripts/lib/sepolia-integration-preflight.js";
import {
  SPLIT_AMOUNT,
  SPLIT_CONFIRMATION,
  SPLIT_CONDITION_ID,
  SPLIT_QUESTION_ID,
  SPLIT_WALLET,
  parseSplitMode,
  runSepoliaBinarySplit,
  SepoliaSplitError,
  type SplitReader,
} from "../../scripts/lib/sepolia-binary-split.js";

const oracle = SPLIT_WALLET;
const ctfRuntime = "0x6000" as Hex;
const collateralRuntime = "0x6001" as Hex;
const adapterRuntime = "0x6002" as Hex;
const txHash = `0x${"cd".repeat(32)}` as Hex;
const record = {
  questionId: SPLIT_QUESTION_ID,
  conditionId: SPLIT_CONDITION_ID,
  ctfAddress: INTEGRATION_ADDRESSES.ctf,
};
const artifact = {
  ctfRuntime,
  collateralRuntime,
  adapterRuntime,
  adapterImmutableReferences: [],
};

function makeReader(overrides: Partial<SplitReader> = {}) {
  let sent = 0;
  let yesBalance = 3n;
  let noBalance = 4n;
  const operations: string[] = [];
  const reader: SplitReader = {
    getChainId: async () => 11155111,
    getCode: async (address) => {
      if (address === INTEGRATION_ADDRESSES.ctf) return ctfRuntime;
      if (address === INTEGRATION_ADDRESSES.collateral) return collateralRuntime;
      return adapterRuntime;
    },
    getAdapterCtf: async () => INTEGRATION_ADDRESSES.ctf,
    getAdapterCollateral: async () => INTEGRATION_ADDRESSES.collateral,
    getConditionId: async () => SPLIT_CONDITION_ID,
    getOutcomeSlotCount: async () => 2n,
    getPayoutDenominator: async () => 0n,
    getTokenDecimals: async () => 18,
    getTokenBalance: async () => 100n * SPLIT_AMOUNT,
    getAllowance: async () => SPLIT_AMOUNT,
    getPositionIds: async () => ({
      conditionId: SPLIT_CONDITION_ID,
      yesPositionId: 101n,
      noPositionId: 202n,
    }),
    getPositionBalance: async (_wallet, positionId) => positionId === 101n ? yesBalance : noBalance,
    simulateSplit: async (wallet, passedOracle, questionId, amount) => {
      operations.push("simulate");
      assert.equal(wallet, SPLIT_WALLET);
      assert.equal(passedOracle, SPLIT_WALLET);
      assert.equal(questionId, SPLIT_QUESTION_ID);
      assert.equal(amount, SPLIT_AMOUNT);
    },
    estimateSplit: async (_wallet, _oracle, questionId, amount) => {
      operations.push("estimate");
      assert.equal(questionId, SPLIT_QUESTION_ID);
      assert.equal(amount, SPLIT_AMOUNT);
      return 248_000n;
    },
    submitSplit: async (_wallet, _oracle, questionId, amount) => {
      operations.push("splitBinary");
      sent += 1;
      assert.equal(questionId, SPLIT_QUESTION_ID);
      assert.equal(amount, SPLIT_AMOUNT);
      yesBalance += amount;
      noBalance += amount;
      return txHash;
    },
    waitForReceipt: async () => "success",
    ...overrides,
  };
  return { reader, sent: () => sent, operations };
}

async function run(reader: SplitReader, confirm?: () => Promise<string>, onPreflight?: (result: Parameters<NonNullable<Parameters<typeof runSepoliaBinarySplit>[6]>>[0]) => void) {
  return runSepoliaBinarySplit(SPLIT_WALLET, oracle, record, confirm, reader, artifact, onPreflight);
}

describe("guarded Sepolia binary split", () => {
  it("selects read-only by default and requires --submit for the confirmed path", () => {
    assert.equal(parseSplitMode([]), "preflight");
    assert.equal(parseSplitMode(["--submit"]), "submit");
    assert.throws(() => parseSplitMode(["--force"]), /read-only preflight/);
  });

  it("validates the fixed wallet and saved condition identity", async () => {
    const differentWallet = `0x${"77".repeat(20)}` as Address;
    await assert.rejects(
      runSepoliaBinarySplit(differentWallet, oracle, record, undefined, makeReader().reader, artifact),
      /Wallet does not match/,
    );
    await assert.rejects(
      runSepoliaBinarySplit(SPLIT_WALLET, oracle, { ...record, questionId: `0x${"00".repeat(32)}` as Hex }, undefined, makeReader().reader, artifact),
      /Saved condition identity/,
    );
  });

  it("stops on the wrong network before checking contract data", async () => {
    let codeReads = 0;
    const state = makeReader({
      getChainId: async () => 1,
      getCode: async () => { codeReads += 1; return ctfRuntime; },
    });
    await assert.rejects(run(state.reader), /expected Sepolia 11155111/);
    assert.equal(codeReads, 0);
    assert.equal(state.sent(), 0);
  });

  it("requires all three contracts to have the pinned runtime code", async () => {
    for (const missing of [INTEGRATION_ADDRESSES.ctf, INTEGRATION_ADDRESSES.collateral, INTEGRATION_ADDRESSES.adapter]) {
      const state = makeReader({
        getCode: async (address) => address === missing ? "0x" :
          address === INTEGRATION_ADDRESSES.ctf ? ctfRuntime :
            address === INTEGRATION_ADDRESSES.collateral ? collateralRuntime : adapterRuntime,
      });
      await assert.rejects(run(state.reader), /has no code/);
      assert.equal(state.sent(), 0);
    }
  });

  it("checks adapter addresses and official condition identity/status", async () => {
    await assert.rejects(
      run(makeReader({ getAdapterCtf: async () => INTEGRATION_ADDRESSES.adapter }).reader),
      /Adapter ctf\(\) or collateral\(\)/,
    );
    await assert.rejects(
      run(makeReader({ getConditionId: async () => `0x${"88".repeat(32)}` as Hex }).reader),
      /condition IDs do not match/,
    );
    await assert.rejects(
      run(makeReader({ getOutcomeSlotCount: async () => 0n }).reader),
      /not prepared as binary/,
    );
    await assert.rejects(
      run(makeReader({ getPayoutDenominator: async () => 1n }).reader),
      /already resolved/,
    );
  });

  it("requires 18 decimals, enough MOCK, and an allowance of at least 1 MOCK", async () => {
    await assert.rejects(run(makeReader({ getTokenDecimals: async () => 6 }).reader), /decimals are not 18/);
    await assert.rejects(run(makeReader({ getTokenBalance: async () => SPLIT_AMOUNT - 1n }).reader), /balance is below/);
    await assert.rejects(run(makeReader({ getAllowance: async () => SPLIT_AMOUNT - 1n }).reader), /allowance.*below 1 MOCK/);
  });

  it("simulates the exact split and estimates gas without sending in preflight mode", async () => {
    const state = makeReader();
    let shown: Awaited<ReturnType<typeof run>> | undefined;
    const result = await run(state.reader, undefined, (summary) => { shown = summary as Awaited<ReturnType<typeof run>>; });
    assert.equal(result.submitted, false);
    assert.equal(result.gasEstimate, 248_000n);
    assert.equal(result.amount, 1_000_000_000_000_000_000n);
    assert.equal(result.questionId, SPLIT_QUESTION_ID);
    assert.equal(shown?.conditionId, SPLIT_CONDITION_ID);
    assert.deepEqual(state.operations, ["simulate", "estimate"]);
    assert.equal(state.sent(), 0);
  });

  it("shows the reviewed details before requesting confirmation and rejects a wrong phrase", async () => {
    const state = makeReader();
    let shown = false;
    await assert.rejects(
      run(state.reader, async () => {
        assert.equal(shown, true);
        return "SPLIT_NOW";
      }, () => { shown = true; }),
      /Exact required phrase/,
    );
    assert.equal(state.sent(), 0);
  });

  it("submits only the exact split after confirmation and verifies both position balances increased", async () => {
    const state = makeReader();
    const result = await run(state.reader, async () => SPLIT_CONFIRMATION);
    assert.equal(state.sent(), 1);
    assert.deepEqual(state.operations, ["simulate", "estimate", "simulate", "splitBinary"]);
    assert.equal(result.submitted, true);
    assert.equal(result.transactionHash, txHash);
    assert.equal(result.yesBalanceAfter, 3n + SPLIT_AMOUNT);
    assert.equal(result.noBalanceAfter, 4n + SPLIT_AMOUNT);
  });

  it("preserves the hash when receipt status fails", async () => {
    const state = makeReader({ waitForReceipt: async () => "reverted" });
    await assert.rejects(
      run(state.reader, async () => SPLIT_CONFIRMATION),
      (error: unknown) => {
        assert.ok(error instanceof SepoliaSplitError);
        assert.equal(error.transactionHash, txHash);
        return true;
      },
    );
  });

  it("reports a hash if receipt succeeds but both outcome positions were not credited", async () => {
    const state = makeReader({ getPositionBalance: async () => 0n });
    await assert.rejects(
      run(state.reader, async () => SPLIT_CONFIRMATION),
      (error: unknown) => {
        assert.ok(error instanceof SepoliaSplitError);
        assert.equal(error.transactionHash, txHash);
        assert.match(error.message, /did not receive/);
        return true;
      },
    );
  });

  it("redacts provider details from read failures", async () => {
    const state = makeReader({ getChainId: async () => { throw new Error("https://rpc.invalid/?key=secret"); } });
    await assert.rejects(
      run(state.reader),
      (error: unknown) => {
        assert.ok(error instanceof SepoliaSplitError);
        assert.match(error.message, /provider details were withheld/);
        assert.doesNotMatch(error.message, /rpc\.invalid|secret/);
        return true;
      },
    );
  });
});
