import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatEther, formatGwei, type Address, type Hex } from "viem";

import {
  calculateCtfDeploymentCost,
  checkCtfDeploymentCost,
  SafePreflightError,
} from "../../scripts/lib/ctf-deployment-check.js";

const deployer = `0x${"11".repeat(20)}` as Address;
const creationBytecode = "0x6000" as Hex;

function mockReader(overrides: Record<string, unknown> = {}) {
  return {
    estimateGas: async () => 21_000n,
    estimateFeesPerGas: async () => ({
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 100_000_000n,
    }),
    getBalance: async () => 0n,
    ...overrides,
  } as Parameters<typeof checkCtfDeploymentCost>[0];
}

describe("CTF deployment preflight calculations", () => {
  it("formats wei per gas as gwei and total wei as ether", () => {
    assert.equal(formatGwei(1_000_000_000n), "1");
    assert.equal(formatGwei(18n), "0.000000018");
    assert.equal(formatEther(21_000n * 1_000_000_000n), "0.000021");
    assert.equal(formatEther(23_457_183n * 18n), "0.000000000422229294");
  });

  it("multiplies gas by the wei-denominated EIP-1559 max fee and adds 25%", () => {
    const costs = calculateCtfDeploymentCost(21_000n, 1_000_000_000n);

    assert.equal(costs.estimatedCostWei, 21_000_000_000_000n);
    assert.equal(costs.requiredBalanceWei, 26_250_000_000_000n);
    assert.equal(formatEther(costs.estimatedCostWei), "0.000021");
    assert.equal(formatEther(costs.requiredBalanceWei), "0.00002625");
  });

  it("rounds the 25% reserve up to the next wei", () => {
    assert.deepEqual(calculateCtfDeploymentCost(1n, 1n), {
      estimatedCostWei: 1n,
      requiredBalanceWei: 2n,
    });
  });

  it("does not accept a zero balance against a positive estimate", async (t) => {
    t.mock.method(console, "log", () => undefined);

    await assert.rejects(
      checkCtfDeploymentCost(mockReader(), deployer, creationBytecode),
      (error: unknown) => {
        assert.ok(error instanceof SafePreflightError);
        assert.match(error.safeDiagnostic, /Insufficient Sepolia ETH/);
        assert.match(error.safeDiagnostic, /25% reserve/);
        return true;
      },
    );
  });

  it("identifies gas-estimation failures without leaking provider messages", async () => {
    const secretUrl = "https://rpc.example/private-api-token";
    const reader = mockReader({
      estimateGas: async () => {
        const error = new Error(secretUrl);
        error.name = "HttpRequestError";
        throw error;
      },
    });

    await assert.rejects(
      checkCtfDeploymentCost(reader, deployer, creationBytecode),
      (error: unknown) => {
        assert.ok(error instanceof SafePreflightError);
        assert.match(error.safeDiagnostic, /CTF creation gas estimation failed/);
        assert.match(error.safeDiagnostic, /HTTP transport error/);
        assert.doesNotMatch(error.safeDiagnostic, /private-api-token/);
        return true;
      },
    );
  });

  it("identifies fee-quote failures without leaking provider messages", async () => {
    const reader = mockReader({
      estimateFeesPerGas: async () => {
        const error = new Error("credential-bearing response details");
        error.name = "RpcRequestError";
        throw error;
      },
    });

    await assert.rejects(
      checkCtfDeploymentCost(reader, deployer, creationBytecode),
      (error: unknown) => {
        assert.ok(error instanceof SafePreflightError);
        assert.match(error.safeDiagnostic, /transaction fee estimation failed/);
        assert.match(error.safeDiagnostic, /RPC rejected the request/);
        assert.doesNotMatch(error.safeDiagnostic, /credential-bearing/);
        return true;
      },
    );
  });

  it("identifies balance-query failures without leaking provider messages", async () => {
    const reader = mockReader({
      getBalance: async () => {
        const error = new Error("sensitive endpoint detail");
        error.name = "TimeoutError";
        throw error;
      },
    });

    await assert.rejects(
      checkCtfDeploymentCost(reader, deployer, creationBytecode),
      (error: unknown) => {
        assert.ok(error instanceof SafePreflightError);
        assert.match(error.safeDiagnostic, /deployer balance lookup failed/);
        assert.match(error.safeDiagnostic, /request timeout/);
        assert.doesNotMatch(error.safeDiagnostic, /sensitive endpoint/);
        return true;
      },
    );
  });
});
