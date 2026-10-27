import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Address, type Hex } from "viem";
import {
  INTEGRATION_ADDRESSES,
  loadIntegrationArtifacts,
  parseIntegrationOptions,
  runIntegrationPreflight,
  SafeIntegrationPreflightError,
  type IntegrationArtifacts,
  type IntegrationReader,
} from "../../scripts/lib/sepolia-integration-preflight.js";

const wallet = `0x${"12".repeat(20)}` as Address;
const oracle = `0x${"34".repeat(20)}` as Address;
const questionId = `0x${"56".repeat(32)}` as Hex;

function patchAdapterImmutables(runtime: Hex, refs: IntegrationArtifacts["adapter"]["immutableReferences"]): Hex {
  const bytes = runtime.slice(2).split("");
  for (const ref of refs) {
    for (let i = ref.start * 2; i < (ref.start + ref.length) * 2; i += 1) bytes[i] = "a";
  }
  return `0x${bytes.join("")}` as Hex;
}

function makeReader(artifacts: IntegrationArtifacts, overrides: Partial<IntegrationReader> = {}) {
  const calls: string[] = [];
  let sendCalls = 0;
  const reader = {
    getChainId: async () => 11155111,
    getCode: async ({ address }: { address: Address }) => {
      if (address === INTEGRATION_ADDRESSES.ctf) return artifacts.ctf.runtime;
      if (address === INTEGRATION_ADDRESSES.collateral) return artifacts.collateral.runtime;
      return patchAdapterImmutables(artifacts.adapter.runtime, artifacts.adapter.immutableReferences);
    },
    readContract: async ({ functionName }: { functionName: string }) => {
      calls.push(functionName);
      const values: Record<string, unknown> = {
        ctf: INTEGRATION_ADDRESSES.ctf,
        collateral: INTEGRATION_ADDRESSES.collateral,
        name: "Mock Collateral",
        symbol: "MOCK",
        decimals: 18,
        totalSupply: 100n * 10n ** 18n,
        balanceOf: 7n,
        allowance: 0n,
        isApprovedForAll: false,
        getConditionId: `0x${"ab".repeat(32)}`,
        getOutcomeSlotCount: 2n,
        payoutDenominator: 0n,
        getBinaryPositionIds: [`0x${"ab".repeat(32)}`, `0x${"01".repeat(32)}`, `0x${"02".repeat(32)}`, 101n, 102n],
      };
      return values[functionName];
    },
    sendTransaction: async () => { sendCalls += 1; throw new Error("must not be called"); },
    ...overrides,
  } as IntegrationReader & { sendTransaction: () => Promise<never> };
  return { reader, calls, sendCalls: () => sendCalls };
}

describe("read-only Sepolia integration preflight", () => {
  it("checks artifact compatibility and optional wallet, approval, and condition reads without a transaction sender", async (t) => {
    t.mock.method(console, "log", () => undefined);
    const artifacts = await loadIntegrationArtifacts();
    const { reader, calls, sendCalls } = makeReader(artifacts);
    await runIntegrationPreflight(reader, artifacts, { walletAddress: wallet, oracleAddress: oracle, questionId });
    assert.equal(sendCalls(), 0);
    assert.ok(calls.includes("allowance"));
    assert.ok(calls.includes("isApprovedForAll"));
    assert.ok(calls.includes("getConditionId"));
    assert.ok(calls.includes("getOutcomeSlotCount"));
    assert.ok(calls.includes("payoutDenominator"));
  });

  it("does not read token metadata or balances when no test wallet is supplied", async (t) => {
    t.mock.method(console, "log", () => undefined);
    const artifacts = await loadIntegrationArtifacts();
    const { reader, calls } = makeReader(artifacts);
    await runIntegrationPreflight(reader, artifacts);
    assert.equal(calls.includes("name"), false);
    assert.equal(calls.includes("balanceOf"), false);
    assert.equal(calls.includes("allowance"), false);
    assert.equal(calls.includes("isApprovedForAll"), false);
  });

  it("checks MOCK balance and both approvals with only a test wallet", async (t) => {
    t.mock.method(console, "log", () => undefined);
    const artifacts = await loadIntegrationArtifacts();
    const { reader, calls } = makeReader(artifacts);
    const options = parseIntegrationOptions({ PREFLIGHT_TEST_WALLET_ADDRESS: wallet });
    assert.equal(options.oracleAddress, undefined);
    assert.equal(options.questionId, undefined);
    await runIntegrationPreflight(reader, artifacts, options);
    assert.ok(calls.includes("balanceOf"));
    assert.ok(calls.includes("allowance"));
    assert.ok(calls.includes("isApprovedForAll"));
    assert.equal(calls.includes("getConditionId"), false);
    assert.equal(calls.includes("getOutcomeSlotCount"), false);
  });

  it("accepts oracle and question ID together for optional condition inspection", () => {
    assert.deepEqual(
      parseIntegrationOptions({
        PREFLIGHT_ORACLE_ADDRESS: oracle,
        PREFLIGHT_QUESTION_ID: questionId,
      }),
      { walletAddress: undefined, oracleAddress: oracle, questionId },
    );
  });

  it("rejects incomplete condition inputs", () => {
    assert.throws(
      () => parseIntegrationOptions({ PREFLIGHT_ORACLE_ADDRESS: oracle }),
      /Supply both PREFLIGHT_ORACLE_ADDRESS and PREFLIGHT_QUESTION_ID/,
    );
    assert.throws(
      () => parseIntegrationOptions({ PREFLIGHT_QUESTION_ID: questionId }),
      /Supply both PREFLIGHT_ORACLE_ADDRESS and PREFLIGHT_QUESTION_ID/,
    );
  });

  it("stops before contract reads on a wrong chain", async () => {
    const artifacts = await loadIntegrationArtifacts();
    const { reader } = makeReader(artifacts, { getChainId: async () => 1 });
    await assert.rejects(
      runIntegrationPreflight(reader, artifacts),
      /expected Sepolia 11155111/,
    );
  });

  it("reports RPC failures safely without echoing endpoint or credentials", async () => {
    const artifacts = await loadIntegrationArtifacts();
    const { reader } = makeReader(artifacts, {
      getChainId: async () => {
        const error = new Error("https://provider.invalid/rpc?key=secret-token");
        error.name = "HttpRequestError";
        throw error;
      },
    });
    await assert.rejects(
      runIntegrationPreflight(reader, artifacts),
      (error: unknown) => {
        assert.ok(error instanceof SafeIntegrationPreflightError);
        assert.match(error.diagnostic, /HTTP\/transport error/);
        assert.doesNotMatch(error.diagnostic, /provider\.invalid|secret-token/);
        return true;
      },
    );
  });

  it("rejects mismatched adapter configuration and invalid optional inputs", async (t) => {
    t.mock.method(console, "log", () => undefined);
    const artifacts = await loadIntegrationArtifacts();
    const { reader } = makeReader(artifacts, {
      readContract: async <T = unknown>(): Promise<T> => INTEGRATION_ADDRESSES.collateral as T,
    });
    await assert.rejects(runIntegrationPreflight(reader, artifacts), /getters do not point/);
    assert.throws(() => parseIntegrationOptions({ PREFLIGHT_ORACLE_ADDRESS: oracle }), /both PREFLIGHT_ORACLE_ADDRESS/);
    assert.throws(() => parseIntegrationOptions({ PREFLIGHT_TEST_WALLET_ADDRESS: "0xbad" }), /20-byte EVM address/);
  });
});
