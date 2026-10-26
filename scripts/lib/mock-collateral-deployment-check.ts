import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  formatEther,
  formatGwei,
  type Abi,
  type Address,
  type Hex,
} from "viem";

const MOCK_COLLATERAL_ARTIFACT_PATH =
  "artifacts/contracts/ctf-practice/MockCollateral.sol/MockCollateral.json";
const MOCK_COLLATERAL_SOURCE_NAME = "contracts/ctf-practice/MockCollateral.sol";
const INITIAL_SUPPLY = 100n * 10n ** 18n;
const BALANCE_MARGIN_PERCENT = 25n;
const PERCENT_DENOMINATOR = 100n;

type ArtifactBytecode =
  | string
  | {
      object?: unknown;
      linkReferences?: unknown;
    };

type MockCollateralArtifactJson = {
  contractName?: unknown;
  sourceName?: unknown;
  abi?: unknown;
  bytecode?: ArtifactBytecode;
  deployedBytecode?: ArtifactBytecode;
  linkReferences?: unknown;
  deployedLinkReferences?: unknown;
};

export type MockCollateralArtifact = {
  abi: Abi;
  creation: Hex;
  runtime: Hex;
};

type DeploymentReader = {
  estimateGas(args: { account: Address; data: Hex }): Promise<bigint>;
  estimateFeesPerGas(): Promise<{
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }>;
  getBalance(args: { address: Address }): Promise<bigint>;
};

export type MockCollateralDeploymentCost = {
  estimatedCostWei: bigint;
  requiredBalanceWei: bigint;
};

export type MockCollateralVerificationReader = {
  getCode(args: { address: Address }): Promise<Hex | undefined>;
  readName(args: { address: Address }): Promise<unknown>;
  readSymbol(args: { address: Address }): Promise<unknown>;
  readDecimals(args: { address: Address }): Promise<unknown>;
  readTotalSupply(args: { address: Address }): Promise<unknown>;
  readBalanceOf(args: { address: Address; account: Address }): Promise<unknown>;
};

export class SafeMockCollateralDeploymentError extends Error {
  constructor(readonly safeDiagnostic: string) {
    super(safeDiagnostic);
    this.name = "SafeMockCollateralDeploymentError";
  }
}

function hasReferences(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(hasReferences);
  }
  return value !== undefined && value !== null && value !== false && value !== "";
}

// normalize common Hardhat and compiler bytecode shapes, rejecting unresolved links.
export function normalizeMockCollateralBytecode(
  value: ArtifactBytecode | undefined,
  label: string,
): Hex {
  let object: unknown = value;
  let references: unknown;

  if (typeof value === "object" && value !== null) {
    object = value.object;
    references = value.linkReferences;
  }

  if (hasReferences(references)) {
    throw new Error(`${label} contains unresolved library references.`);
  }
  if (typeof object !== "string") {
    throw new Error(`${label} is missing or has an unsupported artifact format.`);
  }

  const prefixed = object.startsWith("0x") ? object : `0x${object}`;
  if (!/^0x[0-9a-fA-F]+$/.test(prefixed)) {
    throw new Error(`${label} is not valid hexadecimal bytecode.`);
  }
  if ((prefixed.length - 2) % 2 !== 0) {
    throw new Error(`${label} has an odd-length hexadecimal bytecode value.`);
  }
  return prefixed as Hex;
}

function validateNoReferences(value: unknown, label: string): void {
  if (hasReferences(value)) {
    throw new Error(`${label} contains unresolved library references.`);
  }
}

// load and validate the compiled MockCollateral artifact used by Hardhat Viem.
export async function loadMockCollateralArtifact(): Promise<MockCollateralArtifact> {
  let artifact: MockCollateralArtifactJson;
  try {
    const content = await readFile(
      resolve(process.cwd(), MOCK_COLLATERAL_ARTIFACT_PATH),
      "utf8",
    );
    artifact = JSON.parse(content) as MockCollateralArtifactJson;
  } catch {
    throw new SafeMockCollateralDeploymentError(
      "MockCollateral artifact is missing or unreadable. Compile the project first.",
    );
  }

  if (
    artifact.contractName !== "MockCollateral" ||
    artifact.sourceName !== MOCK_COLLATERAL_SOURCE_NAME ||
    !Array.isArray(artifact.abi)
  ) {
    throw new SafeMockCollateralDeploymentError(
      "Artifact identity does not match contracts/ctf-practice/MockCollateral.sol.",
    );
  }

  const constructor = artifact.abi.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "type" in entry &&
      entry.type === "constructor",
  );
  if (
    constructor === undefined ||
    typeof constructor !== "object" ||
    constructor === null ||
    !("inputs" in constructor) ||
    !Array.isArray(constructor.inputs) ||
    constructor.inputs.length !== 0
  ) {
    throw new SafeMockCollateralDeploymentError(
      "MockCollateral artifact must have a no-argument constructor.",
    );
  }

  try {
    validateNoReferences(artifact.linkReferences, "Creation bytecode");
    validateNoReferences(
      artifact.deployedLinkReferences,
      "Runtime bytecode",
    );
    return {
      abi: artifact.abi as Abi,
      creation: normalizeMockCollateralBytecode(
        artifact.bytecode,
        "Creation bytecode",
      ),
      runtime: normalizeMockCollateralBytecode(
        artifact.deployedBytecode,
        "Runtime bytecode",
      ),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Artifact bytecode is invalid.";
    throw new SafeMockCollateralDeploymentError(message);
  }
}

// calculate the maximum quoted cost and round the 25% reserve up to a wei.
export function calculateMockCollateralDeploymentCost(
  gasEstimate: bigint,
  maxFeePerGasWei: bigint,
): MockCollateralDeploymentCost {
  if (gasEstimate < 0n || maxFeePerGasWei < 0n) {
    throw new RangeError("Gas and fee values cannot be negative.");
  }

  const estimatedCostWei = gasEstimate * maxFeePerGasWei;
  const reserveNumerator =
    estimatedCostWei * (PERCENT_DENOMINATOR + BALANCE_MARGIN_PERCENT);
  const requiredBalanceWei =
    (reserveNumerator + PERCENT_DENOMINATOR - 1n) / PERCENT_DENOMINATOR;

  return { estimatedCostWei, requiredBalanceWei };
}

function errorCategory(error: unknown): string {
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
    case "InvalidInputRpcError":
      return "RPC request error";
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
    throw new SafeMockCollateralDeploymentError(
      `${operation} failed (${errorCategory(error)}). Raw provider details were withheld.`,
    );
  }
}

// check the read-only gas estimate, EIP-1559 quote, balance, and 25% reserve.
export async function checkMockCollateralDeploymentCost(
  reader: DeploymentReader,
  deployer: Address,
  creationBytecode: Hex,
): Promise<void> {
  const [gasEstimate, feeQuote, balance] = await Promise.all([
    readSafely("MockCollateral gas estimation", () =>
      reader.estimateGas({ account: deployer, data: creationBytecode }),
    ),
    readSafely("EIP-1559 fee estimation", () => reader.estimateFeesPerGas()),
    readSafely("Deployer balance lookup", () =>
      reader.getBalance({ address: deployer }),
    ),
  ]);

  const { estimatedCostWei, requiredBalanceWei } =
    calculateMockCollateralDeploymentCost(gasEstimate, feeQuote.maxFeePerGas);

  console.log(`Estimated MockCollateral deployment gas: ${gasEstimate} gas`);
  console.log(
    `EIP-1559 max fee: ${formatGwei(feeQuote.maxFeePerGas)} gwei (${feeQuote.maxFeePerGas} wei/gas)`,
  );
  console.log(
    `Estimated maximum cost: ${formatEther(estimatedCostWei)} ETH (${estimatedCostWei} wei)`,
  );
  console.log(
    `Required balance with 25% reserve: ${formatEther(requiredBalanceWei)} ETH (${requiredBalanceWei} wei)`,
  );
  console.log(`Deployer balance: ${formatEther(balance)} ETH (${balance} wei)`);

  if (balance < requiredBalanceWei) {
    throw new SafeMockCollateralDeploymentError(
      `Insufficient Sepolia ETH: balance is ${formatEther(balance)} ETH; ${formatEther(requiredBalanceWei)} ETH is required including the 25% reserve.`,
    );
  }
}

// verify deployed code and the expected educational ERC-20 configuration.
export async function verifyMockCollateralDeployment(
  reader: MockCollateralVerificationReader,
  address: Address,
  deployer: Address,
  deployedRuntime: Hex,
): Promise<void> {
  const code = await readSafely("Deployed contract code lookup", () =>
    reader.getCode({ address }),
  );
  if (code === undefined || code === "0x") {
    throw new SafeMockCollateralDeploymentError(
      "No contract runtime code was found at the returned address.",
    );
  }
  if (code.toLowerCase() !== deployedRuntime.toLowerCase()) {
    throw new SafeMockCollateralDeploymentError(
      "Deployed runtime bytecode does not match the MockCollateral artifact.",
    );
  }

  const name = await readSafely("MockCollateral name check", () =>
    reader.readName({ address }),
  );
  const symbol = await readSafely("MockCollateral symbol check", () =>
    reader.readSymbol({ address }),
  );
  const decimals = await readSafely("MockCollateral decimals check", () =>
    reader.readDecimals({ address }),
  );
  const totalSupply = await readSafely("MockCollateral supply check", () =>
    reader.readTotalSupply({ address }),
  );
  const deployerBalance = await readSafely("MockCollateral recipient check", () =>
    reader.readBalanceOf({ address, account: deployer }),
  );

  if (name !== "Mock Collateral") {
    throw new SafeMockCollateralDeploymentError(
      "Token name verification failed; expected Mock Collateral.",
    );
  }
  if (symbol !== "MOCK") {
    throw new SafeMockCollateralDeploymentError(
      "Token symbol verification failed; expected MOCK.",
    );
  }
  if (decimals !== 18) {
    throw new SafeMockCollateralDeploymentError(
      "Token decimals verification failed; expected 18.",
    );
  }
  if (totalSupply !== INITIAL_SUPPLY) {
    throw new SafeMockCollateralDeploymentError(
      "Token total-supply verification failed; expected 100 tokens at 18 decimals.",
    );
  }
  if (deployerBalance !== INITIAL_SUPPLY) {
    throw new SafeMockCollateralDeploymentError(
      "Token recipient verification failed; expected the deployer to hold the initial 100-token supply.",
    );
  }
}
