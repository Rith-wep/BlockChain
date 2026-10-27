import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address, Hex } from "viem";
import { INTEGRATION_ADDRESSES } from "../../scripts/lib/sepolia-integration-preflight.js";
import {
  APPROVAL_WALLET,
  MOCK_APPROVAL_AMOUNT,
  MOCK_APPROVAL_CONFIRMATION,
  parseApprovalMode,
  runMockCollateralApproval,
  MockCollateralApprovalError,
  type ApprovalReader,
} from "../../scripts/lib/mock-collateral-approval.js";

const tokenRuntime = "0x6000" as Hex;
const adapterRuntime = "0x6001" as Hex;
const txHash = `0x${"ab".repeat(32)}` as Hex;
const artifact = {
  collateralRuntime: tokenRuntime,
  adapterRuntime,
  adapterImmutableReferences: [],
};

function makeReader(overrides: Partial<ApprovalReader> = {}) {
  let sent = 0;
  let allowance = 0n;
  const calls: string[] = [];
  const reader: ApprovalReader = {
    getChainId: async () => 11155111,
    getCode: async (address) => address === INTEGRATION_ADDRESSES.collateral ? tokenRuntime : adapterRuntime,
    getTokenMetadata: async () => ({ name: "Mock Collateral", symbol: "MOCK", decimals: 18 }),
    getAdapterCollateral: async () => INTEGRATION_ADDRESSES.collateral,
    getTokenBalance: async () => 100n * MOCK_APPROVAL_AMOUNT,
    getAllowance: async () => allowance,
    simulateApprove: async (_wallet, spender, amount) => {
      calls.push("simulateApprove");
      assert.equal(spender, INTEGRATION_ADDRESSES.adapter);
      assert.equal(amount, MOCK_APPROVAL_AMOUNT);
    },
    estimateApprove: async (_wallet, spender, amount) => {
      calls.push("estimateApprove");
      assert.equal(spender, INTEGRATION_ADDRESSES.adapter);
      assert.equal(amount, MOCK_APPROVAL_AMOUNT);
      return 46_000n;
    },
    submitApprove: async (_wallet, spender, amount) => {
      calls.push("approve");
      sent += 1;
      assert.equal(spender, INTEGRATION_ADDRESSES.adapter);
      assert.equal(amount, MOCK_APPROVAL_AMOUNT);
      allowance = amount;
      return txHash;
    },
    waitForReceipt: async () => "success",
    ...overrides,
  };
  return { reader, sent: () => sent, calls };
}

describe("Sepolia MockCollateral approval safeguards", () => {
  it("requires --submit to enter the confirmation flow", () => {
    assert.equal(parseApprovalMode([]), "preflight");
    assert.equal(parseApprovalMode(["--submit"]), "submit");
    assert.throws(() => parseApprovalMode(["--force"]), /read-only preflight/);
    assert.throws(() => parseApprovalMode(["--submit", "extra"]), /read-only preflight/);
  });

  it("checks chain, runtime artifacts, metadata, balance, allowance, simulation and gas without sending by default", async () => {
    const state = makeReader();
    let displayed: Parameters<NonNullable<Parameters<typeof runMockCollateralApproval>[4]>>[0] | undefined;
    const result = await runMockCollateralApproval(APPROVAL_WALLET, undefined, state.reader, artifact, (info) => {
      displayed = info;
    });
    assert.equal(result.submitted, false);
    assert.equal(result.amount, 1_000_000_000_000_000_000n);
    assert.equal(result.gasEstimate, 46_000n);
    assert.equal(displayed?.spender, INTEGRATION_ADDRESSES.adapter);
    assert.equal(state.sent(), 0);
    assert.deepEqual(state.calls, ["simulateApprove", "estimateApprove"]);
  });

  it("stops before further checks on a wrong chain", async () => {
    const state = makeReader({ getChainId: async () => 1 });
    await assert.rejects(
      runMockCollateralApproval(APPROVAL_WALLET, undefined, state.reader, artifact),
      /expected Sepolia 11155111/,
    );
    assert.equal(state.sent(), 0);
  });

  it("rejects a different wallet and missing token or adapter code", async () => {
    const otherWallet = `0x${"11".repeat(20)}` as Address;
    await assert.rejects(
      runMockCollateralApproval(otherWallet, undefined, makeReader().reader, artifact),
      /does not match the configured/,
    );
    for (const address of [INTEGRATION_ADDRESSES.collateral, INTEGRATION_ADDRESSES.adapter]) {
      const state = makeReader({ getCode: async (requested) => requested === address ? "0x" : tokenRuntime });
      await assert.rejects(
        runMockCollateralApproval(APPROVAL_WALLET, undefined, state.reader, artifact),
        /has no contract code/,
      );
      assert.equal(state.sent(), 0);
    }
  });

  it("rejects mismatched code, token identity, and adapter collateral configuration", async () => {
    await assert.rejects(
      runMockCollateralApproval(APPROVAL_WALLET, undefined, makeReader({ getCode: async () => "0x9999" as Hex }).reader, artifact),
      /runtime does not match/,
    );
    await assert.rejects(
      runMockCollateralApproval(APPROVAL_WALLET, undefined, makeReader({ getTokenMetadata: async () => ({ name: "Wrong", symbol: "BAD", decimals: 6 }) }).reader, artifact),
      /metadata does not match/,
    );
    await assert.rejects(
      runMockCollateralApproval(APPROVAL_WALLET, undefined, makeReader({ getAdapterCollateral: async () => `0x${"22".repeat(20)}` as Address }).reader, artifact),
      /collateral\(\) does not match/,
    );
  });

  it("rejects a balance below 1 MOCK before simulation", async () => {
    const state = makeReader({ getTokenBalance: async () => MOCK_APPROVAL_AMOUNT - 1n });
    await assert.rejects(
      runMockCollateralApproval(APPROVAL_WALLET, undefined, state.reader, artifact),
      /balance is below/,
    );
    assert.equal(state.calls.includes("simulateApprove"), false);
    assert.equal(state.sent(), 0);
  });

  it("does not send without the exact confirmation phrase", async () => {
    const state = makeReader();
    await runMockCollateralApproval(APPROVAL_WALLET, undefined, state.reader, artifact);
    await assert.rejects(
      runMockCollateralApproval(APPROVAL_WALLET, async () => "APPROVE", state.reader, artifact),
      /Exact required phrase/,
    );
    assert.equal(state.sent(), 0);
  });

  it("shows preflight details before asking for the confirmation phrase", async () => {
    const state = makeReader();
    let summaryShown = false;
    await assert.rejects(
      runMockCollateralApproval(
        APPROVAL_WALLET,
        async () => {
          assert.equal(summaryShown, true);
          return "not-the-phrase";
        },
        state.reader,
        artifact,
        () => { summaryShown = true; },
      ),
      /Exact required phrase/,
    );
    assert.equal(state.sent(), 0);
  });

  it("submits only the exact approve and verifies at least 1 MOCK after receipt", async () => {
    const state = makeReader();
    const result = await runMockCollateralApproval(
      APPROVAL_WALLET,
      async () => MOCK_APPROVAL_CONFIRMATION,
      state.reader,
      artifact,
    );
    assert.equal(state.sent(), 1);
    assert.deepEqual(state.calls, ["simulateApprove", "estimateApprove", "simulateApprove", "approve"]);
    assert.equal(result.submitted, true);
    assert.equal(result.transactionHash, txHash);
    assert.equal(result.verifiedAllowance, MOCK_APPROVAL_AMOUNT);
  });

  it("preserves a transaction hash when receipt status fails", async () => {
    const state = makeReader({ waitForReceipt: async () => "reverted" });
    await assert.rejects(
      runMockCollateralApproval(APPROVAL_WALLET, async () => MOCK_APPROVAL_CONFIRMATION, state.reader, artifact),
      (error: unknown) => {
        assert.ok(error instanceof MockCollateralApprovalError);
        assert.equal(error.transactionHash, txHash);
        return true;
      },
    );
  });

  it("preserves a transaction hash if post-receipt allowance is still insufficient", async () => {
    let allowanceReads = 0;
    const state = makeReader({
      getAllowance: async () => { allowanceReads += 1; return 0n; },
    });
    await assert.rejects(
      runMockCollateralApproval(APPROVAL_WALLET, async () => MOCK_APPROVAL_CONFIRMATION, state.reader, artifact),
      (error: unknown) => {
        assert.ok(error instanceof MockCollateralApprovalError);
        assert.equal(error.transactionHash, txHash);
        assert.match(error.message, /allowance is below 1 MOCK/);
        return true;
      },
    );
    assert.equal(allowanceReads, 3);
  });

  it("redacts provider details from read failures", async () => {
    const state = makeReader({
      getTokenBalance: async () => { throw new Error("https://rpc.invalid/endpoint?key=hidden"); },
    });
    await assert.rejects(
      runMockCollateralApproval(APPROVAL_WALLET, undefined, state.reader, artifact),
      (error: unknown) => {
        assert.ok(error instanceof MockCollateralApprovalError);
        assert.match(error.message, /provider details were withheld/);
        assert.doesNotMatch(error.message, /rpc\.invalid|hidden/);
        return true;
      },
    );
  });
});
