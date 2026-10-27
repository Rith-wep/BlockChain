import { resolve } from "node:path";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import {
  decodeFunctionResult,
  encodeFunctionData,
  type Abi,
  type Address,
  type Hex,
} from "viem";

export const INTEGRATION_ADDRESSES = {
  ctf: "0x0CF01081fa2843BD187AC1A52C5a32C02211ee36" as Address,
  collateral: "0x43F1917aa363882f288E67C5Db118E44B69FD8E1" as Address,
  adapter: "0x8cCB16d29a5F2e94375fCE5072C464f65370dFF0" as Address,
} as const;

const ARTIFACT_PATHS = {
  ctf: "artifacts/@gnosis.pm/conditional-tokens-contracts/contracts/ConditionalTokens.sol/ConditionalTokens.json",
  collateral: "artifacts/contracts/ctf-practice/MockCollateral.sol/MockCollateral.json",
  adapter: "artifacts/contracts/ctf-adapter/LocalCTFAdapter.sol/LocalCTFAdapter.json",
} as const;

const ARTIFACT_IDENTITIES = {
  ctf: {
    contractName: "ConditionalTokens",
    sourceName: "@gnosis.pm/conditional-tokens-contracts/contracts/ConditionalTokens.sol",
  },
  collateral: {
    contractName: "MockCollateral",
    sourceName: "contracts/ctf-practice/MockCollateral.sol",
  },
  adapter: {
    contractName: "LocalCTFAdapter",
    sourceName: "contracts/ctf-adapter/LocalCTFAdapter.sol",
  },
} as const;

export type ImmutableReference = { start: number; length: number };
export type IntegrationArtifact = {
  abi: Abi;
  runtime: Hex;
  immutableReferences: ImmutableReference[];
};
export type IntegrationArtifacts = Record<keyof typeof ARTIFACT_PATHS, IntegrationArtifact>;

export type IntegrationReader = {
  getChainId(): Promise<number>;
  getCode(args: { address: Address }): Promise<Hex | undefined>;
  readContract<T = unknown>(args: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<T>;
};

export type IntegrationOptions = {
  walletAddress?: Address;
  oracleAddress?: Address;
  questionId?: Hex;
};

export class SafeIntegrationPreflightError extends Error {
  constructor(readonly diagnostic: string) {
    super(diagnostic);
    this.name = "SafeIntegrationPreflightError";
  }
}

function fail(diagnostic: string): never {
  throw new SafeIntegrationPreflightError(diagnostic);
}

function errorCategory(error: unknown): string {
  const name = typeof error === "object" && error !== null && "name" in error
    ? String(error.name)
    : "";
  const code = typeof error === "object" && error !== null && "cause" in error &&
      typeof error.cause === "object" && error.cause !== null && "code" in error.cause
    ? String(error.cause.code)
    : typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (name === "TimeoutError" || name === "AbortError" || code === "ETIMEDOUT") return "request timeout";
  if (name === "HttpRequestError" || code === "EACCES" || code === "ECONNRESET") return "HTTP/transport error";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS resolution error";
  if (code.startsWith("CERT") || code === "ERR_TLS_CERT_ALTNAME_INVALID") return "TLS certificate error";
  if (name.includes("Rpc") || name.includes("ContractFunction")) return "RPC/contract read error";
  return "provider/client error";
}

async function safeRead<T>(operation: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    fail(`${operation} failed (${errorCategory(error)}). Sensitive provider details were withheld.`);
  }
}

function normalizeRuntime(value: unknown, label: string): Hex {
  if (typeof value !== "string") fail(`${label} runtime bytecode is missing from its artifact.`);
  const bytecode = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(bytecode)) {
    fail(`${label} artifact runtime bytecode is malformed or contains unresolved links.`);
  }
  return bytecode as Hex;
}

function references(value: unknown, runtime: Hex, label: string): ImmutableReference[] {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const result: ImmutableReference[] = [];
  for (const entries of Object.values(value)) {
    if (!Array.isArray(entries)) fail(`${label} immutable-reference map is malformed.`);
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null || !("start" in entry) || !("length" in entry)) {
        fail(`${label} immutable-reference entry is malformed.`);
      }
      const { start, length } = entry;
      if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 0 ||
          typeof length !== "number" || !Number.isSafeInteger(length) || length <= 0 ||
          start + length > (runtime.length - 2) / 2) {
        fail(`${label} immutable-reference offsets do not fit its runtime bytecode.`);
      }
      result.push({ start, length });
    }
  }
  return result;
}

export async function loadIntegrationArtifacts(): Promise<IntegrationArtifacts> {
  const loaded = {} as IntegrationArtifacts;
  for (const key of Object.keys(ARTIFACT_PATHS) as (keyof typeof ARTIFACT_PATHS)[]) {
    let artifact: Record<string, unknown>;
    try {
      artifact = JSON.parse(await readFile(resolve(process.cwd(), ARTIFACT_PATHS[key]), "utf8")) as Record<string, unknown>;
    } catch {
      fail(`${key} artifact is missing or unreadable. Compile the project first.`);
    }
    if (artifact.contractName !== ARTIFACT_IDENTITIES[key].contractName ||
        artifact.sourceName !== ARTIFACT_IDENTITIES[key].sourceName || !Array.isArray(artifact.abi)) {
      fail(`${key} artifact identity or ABI does not match the expected project artifact.`);
    }
    const runtime = normalizeRuntime(artifact.deployedBytecode, key);
    loaded[key] = {
      abi: artifact.abi as Abi,
      runtime,
      immutableReferences: references(artifact.immutableReferences, runtime, key),
    };
  }
  if (loaded.adapter.immutableReferences.length === 0) {
    fail("LocalCTFAdapter artifact has no compiler-recorded immutable references.");
  }
  requireFunctions(loaded.ctf.abi, "CTF", [
    ["getConditionId", ["address", "bytes32", "uint256"]],
    ["getCollectionId", ["bytes32", "bytes32", "uint256"]],
    ["getPositionId", ["address", "bytes32"]],
    ["getOutcomeSlotCount", ["bytes32"]],
    ["payoutDenominator", ["bytes32"]],
    ["balanceOf", ["address", "uint256"]],
    ["isApprovedForAll", ["address", "address"]],
    ["setApprovalForAll", ["address", "bool"]],
  ]);
  requireFunctions(loaded.collateral.abi, "MockCollateral", [
    ["name", []], ["symbol", []], ["decimals", []], ["totalSupply", []],
    ["balanceOf", ["address"]], ["allowance", ["address", "address"]],
  ]);
  requireFunctions(loaded.adapter.abi, "LocalCTFAdapter", [
    ["ctf", []], ["collateral", []],
    ["getBinaryConditionId", ["address", "bytes32"]],
    ["getBinaryPositionIds", ["address", "bytes32"]],
    ["splitBinary", ["address", "bytes32", "uint256"]],
    ["mergeBinary", ["address", "bytes32", "uint256"]],
  ]);
  return loaded;
}

function requireFunctions(abi: Abi, label: string, functions: [string, string[]][]): void {
  for (const [name, inputTypes] of functions) {
    const found = abi.some((entry) => entry.type === "function" && entry.name === name &&
      entry.inputs?.map((input) => input.type).join(",") === inputTypes.join(","));
    if (!found) fail(`${label} artifact ABI is missing the expected ${name}(${inputTypes.join(",")}) function.`);
  }
}

export function maskImmutables(bytecode: Hex, refs: readonly ImmutableReference[]): string {
  const chars = bytecode.slice(2).toLowerCase().split("");
  for (const ref of refs) {
    const start = ref.start * 2;
    const end = start + ref.length * 2;
    if (ref.length <= 0 || end > chars.length) fail("Adapter immutable-reference offsets do not fit deployed bytecode.");
    chars.fill("0", start, end);
  }
  return chars.join("");
}

function compareBytecode(actual: Hex | undefined, artifact: IntegrationArtifact, label: string, mask = false): void {
  if (actual === undefined || actual === "0x") fail(`${label} address has no contract code.`);
  const matches = mask
    ? actual.length === artifact.runtime.length &&
      maskImmutables(actual, artifact.immutableReferences) === maskImmutables(artifact.runtime, artifact.immutableReferences)
    : actual.toLowerCase() === artifact.runtime.toLowerCase();
  if (!matches) fail(`${label} runtime bytecode does not match the pinned local artifact.`);
}

async function readFrom<T>(reader: IntegrationReader, address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []): Promise<T> {
  return safeRead(`${functionName} read`, () => reader.readContract<T>({ address, abi, functionName, args }));
}

export async function runIntegrationPreflight(
  reader: IntegrationReader,
  artifacts: IntegrationArtifacts,
  options: IntegrationOptions = {},
): Promise<void> {
  const chainId = await safeRead("Sepolia chain-ID read", () => reader.getChainId());
  if (chainId !== 11155111) fail(`RPC chain ID is ${chainId}; expected Sepolia 11155111.`);
  console.log("Verified network: Ethereum Sepolia (chain ID 11155111).");

  const [ctfCode, collateralCode, adapterCode] = await Promise.all([
    safeRead("CTF code lookup", () => reader.getCode({ address: INTEGRATION_ADDRESSES.ctf })),
    safeRead("MockCollateral code lookup", () => reader.getCode({ address: INTEGRATION_ADDRESSES.collateral })),
    safeRead("LocalCTFAdapter code lookup", () => reader.getCode({ address: INTEGRATION_ADDRESSES.adapter })),
  ]);
  compareBytecode(ctfCode, artifacts.ctf, "CTF");
  compareBytecode(collateralCode, artifacts.collateral, "MockCollateral");
  compareBytecode(adapterCode, artifacts.adapter, "LocalCTFAdapter", true);
  console.log(`CTF runtime matches the pinned artifact: ${INTEGRATION_ADDRESSES.ctf}`);
  console.log(`MockCollateral runtime matches the pinned artifact: ${INTEGRATION_ADDRESSES.collateral}`);
  console.log(`LocalCTFAdapter runtime matches outside compiler-recorded immutables: ${INTEGRATION_ADDRESSES.adapter}`);
  console.log("Bytecode match supports artifact compatibility; it does not by itself prove source provenance.");

  const [configuredCtf, configuredCollateral] = await Promise.all([
    readFrom<Address>(reader, INTEGRATION_ADDRESSES.adapter, artifacts.adapter.abi, "ctf"),
    readFrom<Address>(reader, INTEGRATION_ADDRESSES.adapter, artifacts.adapter.abi, "collateral"),
  ]);
  if (configuredCtf.toLowerCase() !== INTEGRATION_ADDRESSES.ctf.toLowerCase() ||
      configuredCollateral.toLowerCase() !== INTEGRATION_ADDRESSES.collateral.toLowerCase()) {
    fail("Adapter immutable getters do not point to the expected CTF and collateral addresses.");
  }
  console.log("Adapter ctf() and collateral() getters match the expected addresses.");

  if (options.walletAddress) {
    const [name, symbol, decimals, totalSupply, collateralBalance] = await Promise.all([
      readFrom<string>(reader, INTEGRATION_ADDRESSES.collateral, artifacts.collateral.abi, "name"),
      readFrom<string>(reader, INTEGRATION_ADDRESSES.collateral, artifacts.collateral.abi, "symbol"),
      readFrom<number | bigint>(reader, INTEGRATION_ADDRESSES.collateral, artifacts.collateral.abi, "decimals"),
      readFrom<bigint>(reader, INTEGRATION_ADDRESSES.collateral, artifacts.collateral.abi, "totalSupply"),
      readFrom<bigint>(reader, INTEGRATION_ADDRESSES.collateral, artifacts.collateral.abi, "balanceOf", [options.walletAddress]),
    ]);
    console.log(`MockCollateral: ${name} (${symbol}), decimals ${decimals}, total supply ${totalSupply}; supplied wallet balance ${collateralBalance}.`);
    const [allowance, operatorApproval] = await Promise.all([
      readFrom<bigint>(reader, INTEGRATION_ADDRESSES.collateral, artifacts.collateral.abi, "allowance", [options.walletAddress, INTEGRATION_ADDRESSES.adapter]),
      readFrom<boolean>(reader, INTEGRATION_ADDRESSES.ctf, artifacts.ctf.abi, "isApprovedForAll", [options.walletAddress, INTEGRATION_ADDRESSES.adapter]),
    ]);
    console.log(`Supplied wallet ERC-20 allowance to adapter: ${allowance}; ERC-1155 operator approval: ${operatorApproval}.`);
  } else {
    console.log("Wallet token metadata and balance reads skipped: no test wallet address was supplied.");
    if (options.oracleAddress) console.log("Approval reads skipped: supply a test wallet address as well.");
  }

  if (options.oracleAddress && options.questionId) {
    const conditionId = await readFrom<Hex>(reader, INTEGRATION_ADDRESSES.ctf, artifacts.ctf.abi, "getConditionId", [options.oracleAddress, options.questionId, 2n]);
    const [outcomeSlotCount, payoutDenominator] = await Promise.all([
      readFrom<bigint>(reader, INTEGRATION_ADDRESSES.ctf, artifacts.ctf.abi, "getOutcomeSlotCount", [conditionId]),
      readFrom<bigint>(reader, INTEGRATION_ADDRESSES.ctf, artifacts.ctf.abi, "payoutDenominator", [conditionId]),
    ]);
    const prepared = outcomeSlotCount === 2n;
    const resolved = payoutDenominator > 0n;
    const positionIds = await readFrom<readonly [Hex, Hex, Hex, bigint, bigint]>(reader, INTEGRATION_ADDRESSES.adapter, artifacts.adapter.abi, "getBinaryPositionIds", [options.oracleAddress, options.questionId]);
    if (positionIds[0].toLowerCase() !== conditionId.toLowerCase()) fail("Adapter and official CTF condition IDs disagree.");
    console.log(`Condition ${conditionId}: prepared ${prepared}; outcome slots ${outcomeSlotCount}; resolved ${resolved}; payout denominator ${payoutDenominator}.`);
    console.log(`YES position ID: ${positionIds[3]}; NO position ID: ${positionIds[4]}.`);
    if (options.walletAddress) {
      const [yesBalance, noBalance] = await Promise.all([
        readFrom<bigint>(reader, INTEGRATION_ADDRESSES.ctf, artifacts.ctf.abi, "balanceOf", [options.walletAddress, positionIds[3]]),
        readFrom<bigint>(reader, INTEGRATION_ADDRESSES.ctf, artifacts.ctf.abi, "balanceOf", [options.walletAddress, positionIds[4]]),
      ]);
      console.log(`Supplied wallet YES balance: ${yesBalance}; NO balance: ${noBalance}.`);
    }
  } else if (options.oracleAddress || options.questionId) {
    fail("Condition inspection requires both PREFLIGHT_ORACLE_ADDRESS and PREFLIGHT_QUESTION_ID.");
  } else {
    console.log("Condition reads skipped: no oracle and question ID were supplied.");
  }

  console.log("Read-only integration preflight complete. No transaction was signed or sent.");
}

export async function loadRpcUrl(environmentValue: string | undefined): Promise<string> {
  if (environmentValue !== undefined && environmentValue.trim() !== "") return validateRpcUrl(environmentValue.trim());
  const envPath = resolve(process.cwd(), ".env");
  let found: string | undefined;
  try {
    const lines = createInterface({ input: createReadStream(envPath), crlfDelay: Infinity });
    let matches = 0;
    for await (const line of lines) {
      if (!/^\s*(?:export\s+)?SEPOLIA_RPC_URL\s*=/.test(line)) continue;
      matches += 1;
      if (matches > 1) fail(".env contains duplicate SEPOLIA_RPC_URL entries; resolve duplicates before running.");
      const raw = line.replace(/^\s*(?:export\s+)?SEPOLIA_RPC_URL\s*=\s*/, "").trim();
      if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) found = raw.slice(1, -1);
      else found = raw.replace(/\s+#.*$/, "").trim();
    }
  } catch (error) {
    if (error instanceof SafeIntegrationPreflightError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      // A missing .env is fine if no fallback is needed; the user gets a safe missing-setting diagnostic below.
    } else {
      fail("Could not read the local .env file safely; provider details were withheld.");
    }
  }
  if (!found) fail("SEPOLIA_RPC_URL is not set in the process environment or local .env file.");
  return validateRpcUrl(found);
}

function validateRpcUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
    return value;
  } catch {
    fail("SEPOLIA_RPC_URL must be a valid HTTP or HTTPS URL; its value was withheld.");
  }
}

export function parseIntegrationOptions(environment: NodeJS.ProcessEnv): IntegrationOptions {
  const walletAddress = parseAddress(environment.PREFLIGHT_TEST_WALLET_ADDRESS, "PREFLIGHT_TEST_WALLET_ADDRESS");
  const oracleAddress = parseAddress(environment.PREFLIGHT_ORACLE_ADDRESS, "PREFLIGHT_ORACLE_ADDRESS");
  const questionId = environment.PREFLIGHT_QUESTION_ID;
  if (questionId !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(questionId)) {
    fail("PREFLIGHT_QUESTION_ID must be a 32-byte hex value.");
  }
  if ((oracleAddress === undefined) !== (questionId === undefined)) {
    fail("Supply both PREFLIGHT_ORACLE_ADDRESS and PREFLIGHT_QUESTION_ID, or neither.");
  }
  return { walletAddress, oracleAddress, questionId: questionId as Hex | undefined };
}

function parseAddress(value: string | undefined, name: string): Address | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) fail(`${name} must be a 20-byte EVM address.`);
  return value as Address;
}

export function createArtifactReader(artifact: IntegrationArtifact) {
  return async <T>(reader: { call(args: { to: Address; data: Hex }): Promise<{ data?: Hex } | undefined> }, address: Address, functionName: string, args: readonly unknown[] = []): Promise<T> => {
    const data = encodeFunctionData({ abi: artifact.abi, functionName, args } as never);
    const result = await reader.call({ to: address, data });
    if (!result?.data) fail(`${functionName} returned no data.`);
    return decodeFunctionResult({ abi: artifact.abi, functionName, data: result.data } as never) as T;
  };
}
