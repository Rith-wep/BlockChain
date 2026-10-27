import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Address, type Hex } from "viem";

import {
  calculateAdapterDeploymentCost,
  checkAdapterDeploymentCost,
  encodeLocalCTFAdapterDeployment,
  EXPECTED_SEPOLIA_COLLATERAL_ADDRESS,
  EXPECTED_SEPOLIA_CTF_ADDRESS,
  formatAdapterDeploymentFailure,
  loadLocalCTFAdapterArtifact,
  parseAdapterPreflightOnly,
  requireAdapterContractCode,
  SafeAdapterDeploymentError,
  submitAdapterDeploymentUnlessPreflightOnly,
  validateExpectedAdapterAddress,
  verifyAdapterConstructorAddresses,
  verifyLocalCTFAdapterRuntime,
} from "../../scripts/lib/adapter-deployment-check.js";

const deployer = `0x${"11".repeat(20)}` as Address;
const contract = `0x${"22".repeat(20)}` as Address;
const runtime = "0x60006000" as Hex;

function mockReader(overrides: Record<string, unknown> = {}) {
  return {
    getCode: async () => runtime,
    estimateGas: async () => 100_000n,
    estimateFeesPerGas: async () => ({
      maxFeePerGas: 10n,
      maxPriorityFeePerGas: 1n,
    }),
    getBalance: async () => 1_250_000n,
    ...overrides,
  } as Parameters<typeof checkAdapterDeploymentCost>[0] &
    Parameters<typeof requireAdapterContractCode>[0];
}

describe("LocalCTFAdapter deployment safeguards", () => {
  it("accepts only explicit preflight-only mode values", () => {
    assert.equal(parseAdapterPreflightOnly(undefined), false);
    assert.equal(parseAdapterPreflightOnly("false"), false);
    assert.equal(parseAdapterPreflightOnly("true"), true);
    assert.throws(() => parseAdapterPreflightOnly("TRUE"), /exactly 'true' or 'false'/);
  });

  it("never invokes the deployment sender in preflight-only mode", async () => {
    let sendCalls = 0;
    const result = await submitAdapterDeploymentUnlessPreflightOnly(true, async () => {
      sendCalls += 1;
      return "transaction-sent";
    });
    assert.equal(result, undefined);
    assert.equal(sendCalls, 0);
  });

  it("still invokes the deployment sender in normal mode", async () => {
    let sendCalls = 0;
    const result = await submitAdapterDeploymentUnlessPreflightOnly(false, async () => {
      sendCalls += 1;
      return "deployment-result";
    });
    assert.equal(result, "deployment-result");
    assert.equal(sendCalls, 1);
  });

  it("calculates the estimated maximum cost and rounds the 25% reserve up", () => {
    assert.deepEqual(calculateAdapterDeploymentCost(100n, 10n), {
      estimatedCostWei: 1_000n,
      requiredBalanceWei: 1_250n,
    });
    assert.deepEqual(calculateAdapterDeploymentCost(1n, 1n), {
      estimatedCostWei: 1n,
      requiredBalanceWei: 2n,
    });
  });

  it("preflights the configured addresses, code, exact constructor data, and sufficient balance", async (t) => {
    t.mock.method(console, "log", () => undefined);
    const artifact = await loadLocalCTFAdapterArtifact();
    assert.equal(artifact.abi.some((entry) => entry.type === "constructor"), true);
    assert.ok(artifact.immutableReferences.length > 0);

    const ctf = validateExpectedAdapterAddress(
      "SEPOLIA_CTF_ADDRESS",
      EXPECTED_SEPOLIA_CTF_ADDRESS,
      EXPECTED_SEPOLIA_CTF_ADDRESS,
    );
    const collateral = validateExpectedAdapterAddress(
      "SEPOLIA_COLLATERAL_ADDRESS",
      EXPECTED_SEPOLIA_COLLATERAL_ADDRESS,
      EXPECTED_SEPOLIA_COLLATERAL_ADDRESS,
    );
    const reader = mockReader({
      estimateGas: async (args: { account: Address; data: Hex }) => {
        assert.equal(args.account, deployer);
        assert.ok(args.data.startsWith(artifact.creation));
        assert.equal(args.data.slice(-40).toLowerCase(), collateral.slice(2).toLowerCase());
        assert.equal(
          args.data.slice(-104, -64).toLowerCase(),
          ctf.slice(2).toLowerCase(),
        );
        return 100_000n;
      },
      getCode: async () => "0x6001",
      getBalance: async () => 1_250_000n,
    });
    const data = encodeLocalCTFAdapterDeployment(artifact, ctf, collateral);
    await requireAdapterContractCode(reader, "CTF", ctf);
    await requireAdapterContractCode(reader, "MockCollateral", collateral);
    await checkAdapterDeploymentCost(reader, deployer, data);
  });

  it("rejects missing, malformed, or unexpected configured constructor addresses", () => {
    assert.throws(
      () =>
        validateExpectedAdapterAddress(
          "SEPOLIA_CTF_ADDRESS",
          undefined,
          EXPECTED_SEPOLIA_CTF_ADDRESS,
        ),
      /missing or is not a valid/,
    );
    assert.throws(
      () => validateExpectedAdapterAddress("SEPOLIA_CTF_ADDRESS", "0x123", EXPECTED_SEPOLIA_CTF_ADDRESS),
      /missing or is not a valid/,
    );
    assert.throws(
      () =>
        validateExpectedAdapterAddress(
          "SEPOLIA_CTF_ADDRESS",
          EXPECTED_SEPOLIA_COLLATERAL_ADDRESS,
          EXPECTED_SEPOLIA_CTF_ADDRESS,
        ),
      /does not match the reviewed address/,
    );
  });

  it("rejects addresses with missing contract code", async () => {
    const reader = mockReader({ getCode: async () => "0x" });
    await assert.rejects(
      requireAdapterContractCode(reader, "CTF", EXPECTED_SEPOLIA_CTF_ADDRESS),
      /CTF address has no deployed contract code/,
    );
  });

  it("rejects invalid or missing code-query results without leaking provider errors", async () => {
    await assert.rejects(
      requireAdapterContractCode(
        mockReader({
          getCode: async () => {
            const error = new Error("https://rpc.example/key=private-token");
            error.name = "HttpRequestError";
            throw error;
          },
        }),
        "Collateral",
        EXPECTED_SEPOLIA_COLLATERAL_ADDRESS,
      ),
      (error: unknown) => {
        assert.ok(error instanceof SafeAdapterDeploymentError);
        assert.match(error.safeDiagnostic, /Collateral code lookup failed \(HTTP transport error\)/);
        assert.doesNotMatch(error.safeDiagnostic, /rpc\.example|private-token/);
        return true;
      },
    );
  });

  it("rejects insufficient balance after applying the 25% reserve", async (t) => {
    t.mock.method(console, "log", () => undefined);
    await assert.rejects(
      checkAdapterDeploymentCost(
        mockReader({ getBalance: async () => 1_249_999n }),
        deployer,
        "0x6000",
      ),
      (error: unknown) => {
        assert.ok(error instanceof SafeAdapterDeploymentError);
        assert.match(error.safeDiagnostic, /Insufficient Sepolia ETH/);
        assert.match(error.safeDiagnostic, /25% reserve/);
        return true;
      },
    );
  });

  it("rejects missing or mismatched deployed runtime bytecode", async () => {
    await assert.rejects(
      verifyLocalCTFAdapterRuntime(
        mockReader({ getCode: async () => undefined }),
        contract,
        runtime,
        [{ start: 1, length: 2 }],
      ),
      /No runtime contract code/,
    );
    await assert.rejects(
      verifyLocalCTFAdapterRuntime(
        mockReader({ getCode: async () => "0x6001" }),
        contract,
        runtime,
        [{ start: 1, length: 2 }],
      ),
      /does not match the compiled artifact/,
    );
  });

  it("compares non-immutable runtime bytes while allowing constructor-patched immutable values", async () => {
    await verifyLocalCTFAdapterRuntime(
      mockReader({ getCode: async () => "0x60aabb00" }),
      contract,
      runtime,
      [{ start: 1, length: 2 }],
    );
  });

  it("checks the deployed public immutable getters against constructor arguments", () => {
    verifyAdapterConstructorAddresses(
      EXPECTED_SEPOLIA_CTF_ADDRESS,
      EXPECTED_SEPOLIA_COLLATERAL_ADDRESS,
      EXPECTED_SEPOLIA_CTF_ADDRESS,
      EXPECTED_SEPOLIA_COLLATERAL_ADDRESS,
    );
    assert.throws(
      () =>
        verifyAdapterConstructorAddresses(
          EXPECTED_SEPOLIA_COLLATERAL_ADDRESS,
          EXPECTED_SEPOLIA_COLLATERAL_ADDRESS,
          EXPECTED_SEPOLIA_CTF_ADDRESS,
          EXPECTED_SEPOLIA_COLLATERAL_ADDRESS,
        ),
      /do not match the preflight addresses/,
    );
  });

  it("reports receipt failure with submitted identifiers but omits them before submission", () => {
    const hash = `0x${"ab".repeat(32)}`;
    const address = `0x${"cd".repeat(20)}`;
    const afterSubmit = formatAdapterDeploymentFailure(
      "two-confirmation receipt check",
      new SafeAdapterDeploymentError("The deployment receipt reports an unsuccessful transaction status."),
      { transactionHash: hash, contractAddress: address },
    );
    assert.match(afterSubmit[0]!, /receipt reports an unsuccessful/);
    assert.ok(afterSubmit.some((line) => line.includes(hash)));
    assert.ok(afterSubmit.some((line) => line.includes(address)));

    const beforeSubmit = formatAdapterDeploymentFailure(
      "deployment transaction submission",
      new Error("failed at https://rpc.example/key=secret"),
    );
    assert.equal(beforeSubmit.length, 1);
    assert.match(beforeSubmit[0]!, /Raw provider details were withheld/);
    assert.doesNotMatch(beforeSubmit.join(" "), /rpc\.example|secret/);
  });
});
