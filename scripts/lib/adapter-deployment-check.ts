import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  encodeDeployData,
  formatEther,
  formatGwei,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { formatSubmittedDeploymentDetails } from "./deployment-failure-details.js";

const ADAPTER_ARTIFACT_PATH =
  "artifacts/contracts/ctf-adapter/LocalCTFAdapter.sol/LocalCTFAdapter.json";
const ADAPTER_SOURCE_NAME = "contracts/ctf-adapter/LocalCTFAdapter.sol";
const BALANCE_RESERVE_PERCENT = 25n;
const PERCENT_DENOMINATOR = 100n;

export const EXPECTED_SEPOLIA_CTF_ADDRESS =
  "0x0CF01081fa2843BD187AC1A52C5a32C02211ee36" as Address;
export const EXPECTED_SEPOLIA_COLLATERAL_ADDRESS =
  "0x43F1917aa363882f288E67C5Db118E44B69FD8E1" as Address;

type AdapterArtifactJson = {
  contractName?: unknown;
  sourceName?: unknown;
  abi?: unknown;
  bytecode?: unknown;
  deployedBytecode?: unknown;
  linkReferences?: unknown;
  deployedLinkReferences?: unknown;
  immutableReferences?: unknown;
};

export type ImmutableReference = { start: number; length: number };

export type LocalCTFAdapterArtifact = {
  abi: Abi;
  creation: Hex;
  runtime: Hex;
  immutableReferences: ImmutableReference[];
};

type AdapterDeploymentReader = {
  getCode(args: { address: Address }): Promise<Hex | undefined>;
  estimateGas(args: { account: Address; data: Hex }): Promise<bigint>;
  estimateFeesPerGas(): Promise<{
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }>;
  getBalance(args: { address: Address }): Promise<bigint>;
};

export type AdapterDeploymentCost = {
  estimatedCostWei: bigint;
  requiredBalanceWei: bigint;
};

export type SubmittedAdapterDeployment = {
  transactionHash: string;
  contractAddress: string;
};

function parseImmutableReferences(value: unknown, runtime: Hex): ImmutableReference[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SafeAdapterDeploymentError(
      "Adapter artifact is missing its compiler immutable-reference map.",
    );
  }

  const references: ImmutableReference[] = [];
  for (const entries of Object.values(value)) {
    if (!Array.isArray(entries)) {
      throw new SafeAdapterDeploymentError("Adapter artifact immutable-reference data is invalid.");
    }
    for (const entry of entries) {
      if (
        typeof entry !== "object" || entry === null ||
        !("start" in entry) || !("length" in entry) ||
        typeof entry.start !== "number" || !Number.isSafeInteger(entry.start) || entry.start < 0 ||
        typeof entry.length !== "number" || !Number.isSafeInteger(entry.length) || entry.length <= 0 ||
        entry.start + entry.length > (runtime.length - 2) / 2
      ) {
        throw new SafeAdapterDeploymentError("Adapter artifact immutable-reference data is invalid.");
      }
      references.push({ start: entry.start, length: entry.length });
    }
  }

  if (references.length === 0) {
    throw new SafeAdapterDeploymentError(
      "Adapter artifact does not contain the expected immutable references.",
    );
  }
  return references;
}

export class SafeAdapterDeploymentError extends Error {
  constructor(readonly safeDiagnostic: string) {
    super(safeDiagnostic);
    this.name = "SafeAdapterDeploymentError";
  }
}

// accept only explicit true/false values so a typo cannot silently deploy.
export function parseAdapterPreflightOnly(value: string | undefined): boolean {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new SafeAdapterDeploymentError(
    "PREFLIGHT_ONLY must be exactly 'true' or 'false' when set.",
  );
}

// only call the supplied transaction sender after all preflight checks have completed.
export async function submitAdapterDeploymentUnlessPreflightOnly<T>(
  preflightOnly: boolean,
  submit: () => Promise<T>,
): Promise<T | undefined> {
  if (preflightOnly) return undefined;
  return submit();
}

function hasReferences(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(hasReferences);
  }
  return value !== undefined && value !== null && value !== false && value !== "";
}

function normalizeBytecode(value: unknown, label: string): Hex {
  if (typeof value !== "string") {
    throw new SafeAdapterDeploymentError(`${label} is missing or has an unsupported artifact format.`);
  }
  const prefixed = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]+$/.test(prefixed)) {
    throw new SafeAdapterDeploymentError(`${label} is not valid hexadecimal bytecode.`);
  }
  if ((prefixed.length - 2) % 2 !== 0) {
    throw new SafeAdapterDeploymentError(`${label} has an odd-length hexadecimal bytecode value.`);
  }
  return prefixed as Hex;
}

// load and validate the compiled adapter artifact and its two-address constructor.
export async function loadLocalCTFAdapterArtifact(): Promise<LocalCTFAdapterArtifact> {
  let artifact: AdapterArtifactJson;
  try {
    artifact = JSON.parse(
      await readFile(resolve(process.cwd(), ADAPTER_ARTIFACT_PATH), "utf8"),
    ) as AdapterArtifactJson;
  } catch {
    throw new SafeAdapterDeploymentError(
      "LocalCTFAdapter artifact is missing or unreadable. Compile the project first.",
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
  const inputs =
    typeof constructor === "object" && constructor !== null && "inputs" in constructor
      ? constructor.inputs
      : undefined;

  if (
    artifact.contractName !== "LocalCTFAdapter" ||
    artifact.sourceName !== ADAPTER_SOURCE_NAME ||
    !Array.isArray(artifact.abi) ||
    !Array.isArray(inputs) ||
    inputs.length !== 2 ||
    inputs.some(
      (input) =>
        typeof input !== "object" ||
        input === null ||
        !("type" in input) ||
        input.type !== "address",
    ) ||
    hasReferences(artifact.linkReferences) ||
    hasReferences(artifact.deployedLinkReferences)
  ) {
    throw new SafeAdapterDeploymentError(
      "Artifact identity, constructor, or library-link data does not match LocalCTFAdapter.",
    );
  }

  const runtime = normalizeBytecode(artifact.deployedBytecode, "Adapter runtime bytecode");
  return {
    abi: artifact.abi as Abi,
    creation: normalizeBytecode(artifact.bytecode, "Adapter creation bytecode"),
    runtime,
    immutableReferences: parseImmutableReferences(artifact.immutableReferences, runtime),
  };
}

// require the configured constructor address to match the reviewed Sepolia address.
export function validateExpectedAdapterAddress(
  label: string,
  value: string | undefined,
  expected: Address,
): Address {
  if (value === undefined || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new SafeAdapterDeploymentError(`${label} is missing or is not a valid 20-byte EVM address.`);
  }
  if (value.toLowerCase() !== expected.toLowerCase()) {
    throw new SafeAdapterDeploymentError(
      `${label} does not match the reviewed address supplied for this Sepolia deployment.`,
    );
  }
  return value as Address;
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
    case "AbortError":
      return "request timeout";
    case "RpcRequestError":
    case "InvalidInputRpcError":
      return "RPC request error";
    default:
      return "provider/client error";
  }
}

async function readSafely<T>(operation: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new SafeAdapterDeploymentError(
      `${operation} failed (${safeErrorCategory(error)}). Raw provider details were withheld.`,
    );
  }
}

// check that an address has code; this does not verify its identity or provenance.
export async function requireAdapterContractCode(
  reader: Pick<AdapterDeploymentReader, "getCode">,
  label: string,
  address: Address,
): Promise<void> {
  const code = await readSafely(`${label} code lookup`, () => reader.getCode({ address }));
  if (code === undefined || code === "0x") {
    throw new SafeAdapterDeploymentError(`${label} address has no deployed contract code on Sepolia.`);
  }
}

// include ABI-encoded constructor args in the exact creation data used for estimation.
export function encodeLocalCTFAdapterDeployment(
  artifact: LocalCTFAdapterArtifact,
  ctfAddress: Address,
  collateralAddress: Address,
): Hex {
  return encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.creation,
    args: [ctfAddress, collateralAddress],
  });
}

// calculate the maximum quoted cost and round the 25% reserve up to a wei.
export function calculateAdapterDeploymentCost(
  gasEstimate: bigint,
  maxFeePerGasWei: bigint,
): AdapterDeploymentCost {
  if (gasEstimate < 0n || maxFeePerGasWei < 0n) {
    throw new RangeError("Gas and fee values cannot be negative.");
  }
  const estimatedCostWei = gasEstimate * maxFeePerGasWei;
  const numerator = estimatedCostWei * (100n + BALANCE_RESERVE_PERCENT);
  const requiredBalanceWei =
    (numerator + PERCENT_DENOMINATOR - 1n) / PERCENT_DENOMINATOR;
  return { estimatedCostWei, requiredBalanceWei };
}

// estimate deployment cost without signing or sending a transaction.
export async function checkAdapterDeploymentCost(
  reader: Pick<AdapterDeploymentReader, "estimateGas" | "estimateFeesPerGas" | "getBalance">,
  deployer: Address,
  deploymentData: Hex,
): Promise<void> {
  const [gasEstimate, feeQuote, balance] = await Promise.all([
    readSafely("LocalCTFAdapter gas estimation", () =>
      reader.estimateGas({ account: deployer, data: deploymentData }),
    ),
    readSafely("EIP-1559 fee estimation", () => reader.estimateFeesPerGas()),
    readSafely("Deployer balance lookup", () => reader.getBalance({ address: deployer })),
  ]);
  const { estimatedCostWei, requiredBalanceWei } = calculateAdapterDeploymentCost(
    gasEstimate,
    feeQuote.maxFeePerGas,
  );

  console.log(`Estimated LocalCTFAdapter deployment gas: ${gasEstimate} gas`);
  console.log(
    `EIP-1559 max fee: ${formatGwei(feeQuote.maxFeePerGas)} gwei (${feeQuote.maxFeePerGas} wei/gas)`,
  );
  console.log(`Priority fee estimate: ${formatGwei(feeQuote.maxPriorityFeePerGas)} gwei`);
  console.log(
    `Estimated maximum cost: ${formatEther(estimatedCostWei)} ETH (${estimatedCostWei} wei)`,
  );
  console.log(
    `Required balance with 25% reserve: ${formatEther(requiredBalanceWei)} ETH (${requiredBalanceWei} wei)`,
  );
  console.log(`Deployer balance: ${formatEther(balance)} ETH (${balance} wei)`);

  if (balance < requiredBalanceWei) {
    throw new SafeAdapterDeploymentError(
      `Insufficient Sepolia ETH: balance is ${formatEther(balance)} ETH; minimum required is ${formatEther(requiredBalanceWei)} ETH including the 25% reserve.`,
    );
  }
}

// verify deployed runtime code against the same compiled adapter artifact.
export async function verifyLocalCTFAdapterRuntime(
  reader: Pick<AdapterDeploymentReader, "getCode">,
  address: Address,
  expectedRuntime: Hex,
  immutableReferences: readonly ImmutableReference[],
): Promise<void> {
  const code = await readSafely("Deployed adapter code lookup", () => reader.getCode({ address }));
  if (code === undefined || code === "0x") {
    throw new SafeAdapterDeploymentError(
      "No runtime contract code was found at the predicted LocalCTFAdapter address.",
    );
  }
  if (code.length !== expectedRuntime.length) {
    throw new SafeAdapterDeploymentError(
      "Deployed LocalCTFAdapter runtime bytecode does not match the compiled artifact.",
    );
  }

  const maskImmutableBytes = (bytecode: Hex): string => {
    const bytes = bytecode.slice(2).toLowerCase().split("");
    for (const reference of immutableReferences) {
      const start = reference.start * 2;
      const end = start + reference.length * 2;
      if (start < 0 || end > bytes.length || reference.length <= 0) {
        throw new SafeAdapterDeploymentError(
          "Adapter immutable-reference offsets do not fit the runtime bytecode.",
        );
      }
      bytes.fill("0", start, end);
    }
    return bytes.join("");
  };

  if (maskImmutableBytes(code) !== maskImmutableBytes(expectedRuntime)) {
    throw new SafeAdapterDeploymentError(
      "Deployed LocalCTFAdapter runtime bytecode does not match the compiled artifact outside constructor immutables.",
    );
  }
}

// verify the constructor-configured immutable getters separately from the masked bytecode comparison.
export function verifyAdapterConstructorAddresses(
  deployedCtfAddress: Address,
  deployedCollateralAddress: Address,
  expectedCtfAddress: Address,
  expectedCollateralAddress: Address,
): void {
  if (
    deployedCtfAddress.toLowerCase() !== expectedCtfAddress.toLowerCase() ||
    deployedCollateralAddress.toLowerCase() !== expectedCollateralAddress.toLowerCase()
  ) {
    throw new SafeAdapterDeploymentError(
      "Deployed adapter constructor addresses do not match the preflight addresses.",
    );
  }
}

// report the failure stage without printing raw provider errors or credentials.
export function formatAdapterDeploymentFailure(
  stage: string,
  error: unknown,
  submitted?: SubmittedAdapterDeployment,
): string[] {
  const message =
    error instanceof SafeAdapterDeploymentError
      ? error.safeDiagnostic
      : `Unexpected failure (${safeErrorCategory(error)}). Raw provider details were withheld.`;
  return [
    `LocalCTFAdapter deployment stopped during ${stage}: ${message}`,
    ...formatSubmittedDeploymentDetails(submitted),
  ];
}
