import type { Address, Hex } from "viem";
import {
  INTEGRATION_ADDRESSES,
  maskImmutables,
  type ImmutableReference,
} from "./sepolia-integration-preflight.js";

export const APPROVAL_WALLET =
  "0x8cfbcfc0e1c974970f03627e820ded0c95a7b6fa" as Address;
export const MOCK_APPROVAL_AMOUNT = 1_000_000_000_000_000_000n;
export const MOCK_APPROVAL_CONFIRMATION =
  "I_APPROVE_EXACTLY_1_MOCK_TO_ADAPTER_ON_SEPOLIA";

export function parseApprovalMode(args: readonly string[]): "preflight" | "submit" {
  if (args.length === 0) return "preflight";
  if (args.length === 1 && args[0] === "--submit") return "submit";
  throw new Error("Use no arguments for read-only preflight, or --submit to request the confirmed approval flow.");
}

export type ApprovalReader = {
  getChainId(): Promise<number>;
  getCode(address: Address): Promise<Hex | undefined>;
  getTokenMetadata(): Promise<{ name: string; symbol: string; decimals: number }>;
  getAdapterCollateral(): Promise<Address>;
  getTokenBalance(wallet: Address): Promise<bigint>;
  getAllowance(wallet: Address): Promise<bigint>;
  simulateApprove(wallet: Address, spender: Address, amount: bigint): Promise<void>;
  estimateApprove(wallet: Address, spender: Address, amount: bigint): Promise<bigint>;
  submitApprove?: (wallet: Address, spender: Address, amount: bigint) => Promise<Hex>;
  waitForReceipt?: (hash: Hex) => Promise<"success" | "reverted">;
};

export type ApprovalResult = {
  wallet: Address;
  token: Address;
  spender: Address;
  amount: bigint;
  tokenBalance: bigint;
  currentAllowance: bigint;
  gasEstimate: bigint;
  submitted: boolean;
  transactionHash?: Hex;
  verifiedAllowance?: bigint;
};

export class MockCollateralApprovalError extends Error {
  constructor(message: string, readonly transactionHash?: Hex) {
    super(message);
    this.name = "MockCollateralApprovalError";
  }
}

function fail(message: string): never {
  throw new MockCollateralApprovalError(message);
}

export async function runMockCollateralApproval(
  wallet: Address,
  requestConfirmation: (() => Promise<string>) | undefined,
  reader: ApprovalReader,
  artifact: {
    collateralRuntime: Hex;
    adapterRuntime: Hex;
    adapterImmutableReferences: readonly ImmutableReference[];
  },
  onPreflight?: (result: ApprovalResult) => void,
): Promise<ApprovalResult> {
  if (wallet.toLowerCase() !== APPROVAL_WALLET.toLowerCase()) {
    fail("Wallet address does not match the configured Sepolia test wallet.");
  }

  let chainId: number;
  try {
    chainId = await reader.getChainId();
  } catch {
    fail("Sepolia chain-ID request failed; provider details were withheld.");
  }
  if (chainId !== 11155111) fail(`RPC chain ID is ${chainId}; expected Sepolia 11155111.`);

  let tokenCode: Hex | undefined;
  let adapterCode: Hex | undefined;
  try {
    [tokenCode, adapterCode] = await Promise.all([
      reader.getCode(INTEGRATION_ADDRESSES.collateral),
      reader.getCode(INTEGRATION_ADDRESSES.adapter),
    ]);
  } catch {
    fail("Token or adapter contract-code read failed; provider details were withheld.");
  }
  if (!tokenCode || tokenCode === "0x") fail("MockCollateral address has no contract code on Sepolia.");
  if (!adapterCode || adapterCode === "0x") fail("LocalCTFAdapter address has no contract code on Sepolia.");
  if (tokenCode.toLowerCase() !== artifact.collateralRuntime.toLowerCase()) {
    fail("MockCollateral runtime does not match the pinned local artifact.");
  }
  if (adapterCode.length !== artifact.adapterRuntime.length ||
      maskImmutables(adapterCode, artifact.adapterImmutableReferences) !==
        maskImmutables(artifact.adapterRuntime, artifact.adapterImmutableReferences)) {
    fail("LocalCTFAdapter runtime does not match the pinned artifact outside compiler-recorded immutables.");
  }

  let metadata: { name: string; symbol: string; decimals: number };
  let configuredCollateral: Address;
  let tokenBalance: bigint;
  let currentAllowance: bigint;
  try {
    [metadata, configuredCollateral, tokenBalance, currentAllowance] = await Promise.all([
      reader.getTokenMetadata(),
      reader.getAdapterCollateral(),
      reader.getTokenBalance(wallet),
      reader.getAllowance(wallet),
    ]);
  } catch {
    fail("Token or adapter read failed; provider details were withheld.");
  }
  if (metadata.name !== "Mock Collateral" || metadata.symbol !== "MOCK" || metadata.decimals !== 18) {
    fail("Collateral token metadata does not match the expected 18-decimal MOCK practice token.");
  }
  if (configuredCollateral.toLowerCase() !== INTEGRATION_ADDRESSES.collateral.toLowerCase()) {
    fail("Adapter collateral() does not match the expected MockCollateral address.");
  }
  if (tokenBalance < MOCK_APPROVAL_AMOUNT) {
    fail("Wallet MOCK balance is below the exact 1 MOCK approval amount.");
  }

  try {
    await reader.simulateApprove(wallet, INTEGRATION_ADDRESSES.adapter, MOCK_APPROVAL_AMOUNT);
  } catch {
    fail("Exact ERC-20 approve simulation failed; no transaction was sent and provider details were withheld.");
  }
  let gasEstimate: bigint;
  try {
    gasEstimate = await reader.estimateApprove(wallet, INTEGRATION_ADDRESSES.adapter, MOCK_APPROVAL_AMOUNT);
  } catch {
    fail("ERC-20 approve gas estimate failed; no transaction was sent and provider details were withheld.");
  }

  const result: ApprovalResult = {
    wallet,
    token: INTEGRATION_ADDRESSES.collateral,
    spender: INTEGRATION_ADDRESSES.adapter,
    amount: MOCK_APPROVAL_AMOUNT,
    tokenBalance,
    currentAllowance,
    gasEstimate,
    submitted: false,
  };
  onPreflight?.(result);
  if (requestConfirmation === undefined) return result;
  let confirmation: string;
  try {
    confirmation = await requestConfirmation();
  } catch {
    fail("Confirmation input failed; no transaction was sent.");
  }
  if (confirmation !== MOCK_APPROVAL_CONFIRMATION) {
    fail(`Confirmation did not match. Exact required phrase: ${MOCK_APPROVAL_CONFIRMATION}`);
  }
  if (!reader.submitApprove || !reader.waitForReceipt) {
    fail("Confirmed approval requested but no transaction sender is configured.");
  }

  let hash: Hex;
  try {
    // Confirm state immediately before the one permitted approval transaction.
    const latestAllowance = await reader.getAllowance(wallet);
    if (latestAllowance !== currentAllowance) {
      fail("Allowance changed after preflight; rerun the command and review the new value.");
    }
    await reader.simulateApprove(wallet, INTEGRATION_ADDRESSES.adapter, MOCK_APPROVAL_AMOUNT);
    hash = await reader.submitApprove(wallet, INTEGRATION_ADDRESSES.adapter, MOCK_APPROVAL_AMOUNT);
    result.transactionHash = hash;
  } catch (error) {
    if (error instanceof MockCollateralApprovalError) throw error;
    fail("Approval submission request failed without a confirmed transaction hash; broadcast status may be unknown. Check before retrying; provider details were withheld.");
  }

  let receiptStatus: "success" | "reverted";
  try {
    receiptStatus = await reader.waitForReceipt(hash);
  } catch {
    throw new MockCollateralApprovalError(
      "Could not confirm the approval receipt; check this transaction hash before retrying.",
      hash,
    );
  }
  if (receiptStatus !== "success") {
    throw new MockCollateralApprovalError("Approval receipt indicates failure.", hash);
  }
  let verifiedAllowance: bigint;
  try {
    verifiedAllowance = await reader.getAllowance(wallet);
  } catch {
    throw new MockCollateralApprovalError(
      "Receipt succeeded, but allowance verification failed; provider details were withheld.",
      hash,
    );
  }
  if (verifiedAllowance < MOCK_APPROVAL_AMOUNT) {
    throw new MockCollateralApprovalError(
      "Receipt succeeded, but allowance is below 1 MOCK.",
      hash,
    );
  }
  result.submitted = true;
  result.transactionHash = hash;
  result.verifiedAllowance = verifiedAllowance;
  return result;
}
