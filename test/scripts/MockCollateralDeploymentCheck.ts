import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address, Hex } from "viem";

import {
  calculateMockCollateralDeploymentCost,
  checkMockCollateralDeploymentCost,
  loadMockCollateralArtifact,
  normalizeMockCollateralBytecode,
  SafeMockCollateralDeploymentError,
  verifyMockCollateralDeployment,
  type MockCollateralVerificationReader,
} from "../../scripts/lib/mock-collateral-deployment-check.js";
import { formatSubmittedDeploymentDetails } from "../../scripts/lib/deployment-failure-details.js";

const deployer = `0x${"11".repeat(20)}` as Address;
const contract = `0x${"22".repeat(20)}` as Address;
const runtime = "0x60006000" as Hex;
const initialSupply = 100n * 10n ** 18n;

function mockCostReader(overrides: Record<string, unknown> = {}) {
  return {
    estimateGas: async () => 100n,
    estimateFeesPerGas: async () => ({
      maxFeePerGas: 10n,
      maxPriorityFeePerGas: 1n,
    }),
    getBalance: async () => 1_250n,
    ...overrides,
  } as Parameters<typeof checkMockCollateralDeploymentCost>[0];
}

function mockVerificationReader(
  overrides: Partial<MockCollateralVerificationReader> = {},
): MockCollateralVerificationReader {
  return {
    getCode: async () => runtime,
    readName: async () => "Mock Collateral",
    readSymbol: async () => "MOCK",
    readDecimals: async () => 18,
    readTotalSupply: async () => initialSupply,
    readBalanceOf: async () => initialSupply,
    ...overrides,
  };
}

describe("MockCollateral deployment safeguards", () => {
  it("calculates the maximum cost and rounds the 25% reserve up", () => {
    assert.deepEqual(calculateMockCollateralDeploymentCost(100n, 10n), {
      estimatedCostWei: 1_000n,
      requiredBalanceWei: 1_250n,
    });
    assert.deepEqual(calculateMockCollateralDeploymentCost(1n, 1n), {
      estimatedCostWei: 1n,
      requiredBalanceWei: 2n,
    });
  });

  it("accepts a balance equal to the cost plus reserve", async (t) => {
    t.mock.method(console, "log", () => undefined);
    await checkMockCollateralDeploymentCost(mockCostReader(), deployer, runtime);
  });

  it("rejects a balance that is one wei below the 25% reserve", async (t) => {
    t.mock.method(console, "log", () => undefined);
    await assert.rejects(
      checkMockCollateralDeploymentCost(
        mockCostReader({ getBalance: async () => 1_249n }),
        deployer,
        runtime,
      ),
      (error: unknown) => {
        assert.ok(error instanceof SafeMockCollateralDeploymentError);
        assert.match(error.safeDiagnostic, /Insufficient Sepolia ETH/);
        assert.match(error.safeDiagnostic, /25% reserve/);
        return true;
      },
    );
  });

  it("redacts provider errors during gas estimation", async (t) => {
    t.mock.method(console, "log", () => undefined);
    await assert.rejects(
      checkMockCollateralDeploymentCost(
        mockCostReader({
          estimateGas: async () => {
            const error = new Error("https://rpc.example/private-api-token");
            error.name = "HttpRequestError";
            throw error;
          },
        }),
        deployer,
        runtime,
      ),
      (error: unknown) => {
        assert.ok(error instanceof SafeMockCollateralDeploymentError);
        assert.match(error.safeDiagnostic, /MockCollateral gas estimation failed/);
        assert.match(error.safeDiagnostic, /HTTP transport error/);
        assert.doesNotMatch(error.safeDiagnostic, /private-api-token/);
        return true;
      },
    );
  });

  it("normalizes Hardhat string and object bytecode formats", () => {
    assert.equal(normalizeMockCollateralBytecode("6000", "creation"), "0x6000");
    assert.equal(
      normalizeMockCollateralBytecode(
        { object: "6000", linkReferences: {} },
        "runtime",
      ),
      "0x6000",
    );
    assert.throws(
      () =>
        normalizeMockCollateralBytecode(
          { object: "6000", linkReferences: { "lib.sol": { Library: [{ start: 0 }] } } },
          "runtime",
        ),
      /unresolved library references/,
    );
  });

  it("rejects odd-length hexadecimal bytecode", () => {
    assert.throws(
      () => normalizeMockCollateralBytecode("0x600", "runtime"),
      /odd-length hexadecimal bytecode/,
    );
  });

  it("loads the actual no-argument, unlinked Hardhat artifact", async () => {
    const artifact = await loadMockCollateralArtifact();
    assert.ok(artifact.creation.startsWith("0x"));
    assert.ok(artifact.runtime.startsWith("0x"));
    assert.ok(artifact.abi.some((entry) => entry.type === "constructor"));
  });

  it("verifies runtime code and the token identity, supply, and recipient", async () => {
    const reader = mockVerificationReader();
    await verifyMockCollateralDeployment(reader, contract, deployer, runtime);
  });

  it("rejects missing or mismatched runtime bytecode", async () => {
    await assert.rejects(
      verifyMockCollateralDeployment(
        mockVerificationReader({ getCode: async () => undefined }),
        contract,
        deployer,
        runtime,
      ),
      /No contract runtime code/,
    );
    await assert.rejects(
      verifyMockCollateralDeployment(
        mockVerificationReader({ getCode: async () => "0x6001" }),
        contract,
        deployer,
        runtime,
      ),
      /does not match/,
    );
  });

  it("rejects mismatched token metadata, supply, or initial recipient", async () => {
    const mismatches: Array<[
      Partial<MockCollateralVerificationReader>,
      RegExp,
    ]> = [
      [
        { readName: async () => "Other Token" },
        /name verification failed/,
      ],
      [
        { readSymbol: async () => "OTHER" },
        /symbol verification failed/,
      ],
      [
        { readDecimals: async () => 6 },
        /decimals verification failed/,
      ],
      [
        { readTotalSupply: async () => initialSupply - 1n },
        /total-supply verification failed/,
      ],
      [
        { readBalanceOf: async () => 0n },
        /recipient verification failed/,
      ],
    ];

    for (const [override, expectedError] of mismatches) {
      await assert.rejects(
        verifyMockCollateralDeployment(
          mockVerificationReader(override),
          contract,
          deployer,
          runtime,
        ),
        expectedError,
      );
    }
  });

  it("redacts provider details while verifying token metadata", async () => {
    await assert.rejects(
      verifyMockCollateralDeployment(
        mockVerificationReader({
          readName: async () => {
            throw new Error("https://rpc.example/secret-token");
          },
        }),
        contract,
        deployer,
        runtime,
      ),
      (error: unknown) => {
        assert.ok(error instanceof SafeMockCollateralDeploymentError);
        assert.match(error.safeDiagnostic, /MockCollateral name check failed/);
        assert.doesNotMatch(error.safeDiagnostic, /secret-token/);
        return true;
      },
    );
  });

  it("preserves valid submitted transaction identifiers for failure reporting", () => {
    const transactionHash = `0x${"ab".repeat(32)}`;
    const contractAddress = `0x${"cd".repeat(20)}`;
    const details = formatSubmittedDeploymentDetails({
      transactionHash,
      contractAddress,
    });
    assert.ok(details.some((detail) => detail.includes(transactionHash)));
    assert.ok(details.some((detail) => detail.includes(contractAddress)));
  });
});
