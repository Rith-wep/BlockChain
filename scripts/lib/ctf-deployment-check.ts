import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  formatEther,
  formatGwei,
  type Address,
  type Hex,
} from "viem";

const CTF_ARTIFACT_PATH =
  "artifacts/@gnosis.pm/conditional-tokens-contracts/contracts/ConditionalTokens.sol/ConditionalTokens.json";
const CTF_SOURCE_NAME =
  "@gnosis.pm/conditional-tokens-contracts/contracts/ConditionalTokens.sol";
const BALANCE_MARGIN_PERCENT = 25n;
const PERCENT_DENOMINATOR = 100n;

type CtfArtifact = {
  contractName?: unknown;
  sourceName?: unknown;
  abi?: unknown;
  bytecode?: unknown;
  deployedBytecode?: unknown;
  linkReferences?: unknown;
  deployedLinkReferences?: unknown;
};

export type OfficialCtfBytecode = { creation: Hex; runtime: Hex };

type DeploymentReader = {
  estimateGas(args: { account: Address; data: Hex }): Promise<bigint>;
  estimateFeesPerGas(): Promise<{
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }>;
  getBalance(args: { address: Address }): Promise<bigint>;
};

export type CtfDeploymentCost = {
  estimatedCostWei: bigint;
  requiredBalanceWei: bigint;
};

export class SafePreflightError extends Error {
  constructor(readonly safeDiagnostic: string) {
    super(safeDiagnostic);
    this.name = "SafePreflightError";
  }
}

// convert bigint wei values without floating-point rounding.
export function calculateCtfDeploymentCost(
  gasEstimate: bigint,
  feePerGasWei: bigint,
): CtfDeploymentCost {
  if (gasEstimate < 0n || feePerGasWei < 0n) {
    throw new RangeError("Gas and fee values cannot be negative.");
  }

  const estimatedCostWei = gasEstimate * feePerGasWei;
  const reserveNumerator =
    estimatedCostWei * (PERCENT_DENOMINATOR + BALANCE_MARGIN_PERCENT);
  const requiredBalanceWei =
    (reserveNumerator + PERCENT_DENOMINATOR - 1n) / PERCENT_DENOMINATOR;

  return { estimatedCostWei, requiredBalanceWei };
}

function safeErrorCategory(error: unknown): string {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? error.name
      : undefined;

  switch (name) {
    case "HttpRequestError":
      return "HTTP transport error";
    case "TimeoutError":
      return "request timeout";
    case "RpcRequestError":
      return "RPC rejected the request";
    case "InvalidInputRpcError":
      return "RPC rejected the request parameters";
    default:
      return "provider/client error";
  }
}

async function readSafely<T>(
  operation: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new SafePreflightError(
      `${operation} failed (${safeErrorCategory(error)}). No raw provider details were printed.`,
    );
  }
}

// load and sanity-check the official compiled ctf artifact before estimating.
export async function loadOfficialCtfBytecode(): Promise<OfficialCtfBytecode> {
  let artifact: CtfArtifact;
  try {
    const contents = await readFile(resolve(process.cwd(), CTF_ARTIFACT_PATH), "utf8");
    artifact = JSON.parse(contents) as CtfArtifact;
  } catch {
    throw new Error(
      "The official CTF artifact is missing or unreadable. Compile the project first.",
    );
  }

  const constructor = Array.isArray(artifact.abi)
    ? artifact.abi.find(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          "type" in entry &&
          entry.type === "constructor",
      )
    : undefined;

  if (
    artifact.contractName !== "ConditionalTokens" ||
    artifact.sourceName !== CTF_SOURCE_NAME ||
    !Array.isArray(artifact.abi) ||
    (constructor !== undefined &&
      (typeof constructor !== "object" ||
        constructor === null ||
        !("inputs" in constructor) ||
        !Array.isArray(constructor.inputs) ||
        constructor.inputs.length !== 0)) ||
    artifact.linkReferences === undefined ||
    typeof artifact.linkReferences !== "object" ||
    Object.keys(artifact.linkReferences).length !== 0 ||
    artifact.deployedLinkReferences === undefined ||
    typeof artifact.deployedLinkReferences !== "object" ||
    Object.keys(artifact.deployedLinkReferences).length !== 0 ||
    typeof artifact.bytecode !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(artifact.bytecode) ||
    typeof artifact.deployedBytecode !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(artifact.deployedBytecode)
  ) {
    throw new Error(
      "The CTF artifact does not match the expected no-argument, unlinked official contract.",
    );
  }

  return {
    creation: artifact.bytecode as Hex,
    runtime: artifact.deployedBytecode as Hex,
  };
}

// estimate read-only deployment costs using a wei-denominated fee quote.
export async function checkCtfDeploymentCost(
  publicClient: DeploymentReader,
  deployerAddress: Address,
  bytecode: Hex,
): Promise<void> {
  const [gasEstimate, feeQuote, balance] = await Promise.all([
    readSafely("CTF creation gas estimation", () =>
      publicClient.estimateGas({ account: deployerAddress, data: bytecode }),
    ),
    readSafely("transaction fee estimation", () =>
      publicClient.estimateFeesPerGas(),
    ),
    readSafely("deployer balance lookup", () =>
      publicClient.getBalance({ address: deployerAddress }),
    ),
  ]);
  const feePerGasWei = feeQuote.maxFeePerGas;
  const { estimatedCostWei, requiredBalanceWei } = calculateCtfDeploymentCost(
    gasEstimate,
    feePerGasWei,
  );

  console.log(`Estimated deployment gas: ${gasEstimate.toString()}`);
  console.log(
    `EIP-1559 max fee per gas: ${formatGwei(feePerGasWei)} gwei (${feePerGasWei.toString()} wei)`,
  );
  console.log(
    `Priority fee estimate: ${formatGwei(feeQuote.maxPriorityFeePerGas)} gwei`,
  );
  console.log(
    `Estimated maximum deployment cost: ${formatEther(estimatedCostWei)} ETH`,
  );
  console.log(
    `Minimum balance with 25% reserve: ${formatEther(requiredBalanceWei)} ETH`,
  );
  console.log(`Deployer balance: ${formatEther(balance)} ETH`);

  if (balance < requiredBalanceWei) {
    throw new SafePreflightError(
      `Insufficient Sepolia ETH: balance is ${formatEther(balance)} ETH; minimum required is ${formatEther(requiredBalanceWei)} ETH (maximum estimate ${formatEther(estimatedCostWei)} ETH plus 25% reserve). Fund this test wallet with Sepolia test ETH, then rerun preflight.`,
    );
  }
}
