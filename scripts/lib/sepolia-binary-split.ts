import type { Address, Hex } from "viem";
import {
  INTEGRATION_ADDRESSES,
  maskImmutables,
  type ImmutableReference,
} from "./sepolia-integration-preflight.js";

export const SPLIT_WALLET =
  "0x8cfbcfc0e1c974970f03627e820ded0c95a7b6fa" as Address;
export const SPLIT_QUESTION_ID =
  "0x73ab19f7f6dbc9776a16fb868152cc24c8a8bb377e5e8af87a96f29c54bf60be" as Hex;
export const SPLIT_CONDITION_ID =
  "0xededc961c06f120960547f392e1623a6ba2d46a68badafc28ee81f99b45b4cec" as Hex;
export const SPLIT_AMOUNT = 1_000_000_000_000_000_000n;
export const SPLIT_CONFIRMATION =
  "I_CONFIRM_SPLIT_EXACTLY_1_MOCK_ON_SEPOLIA";

export function parseSplitMode(args: readonly string[]): "preflight" | "submit" {
  if (args.length === 0) return "preflight";
  if (args.length === 1 && args[0] === "--submit") return "submit";
  throw new Error("Use no arguments for read-only preflight, or --submit for the confirmed split flow.");
}

export type BinaryPositionIds = {
  conditionId: Hex;
  yesPositionId: bigint;
  noPositionId: bigint;
};

export type SplitReader = {
  getChainId(): Promise<number>;
  getCode(address: Address): Promise<Hex | undefined>;
  getAdapterCtf(): Promise<Address>;
  getAdapterCollateral(): Promise<Address>;
  getConditionId(): Promise<Hex>;
  getOutcomeSlotCount(conditionId: Hex): Promise<bigint>;
  getPayoutDenominator(conditionId: Hex): Promise<bigint>;
  getTokenDecimals(): Promise<number>;
  getTokenBalance(wallet: Address): Promise<bigint>;
  getAllowance(wallet: Address): Promise<bigint>;
  getPositionIds(oracle: Address, questionId: Hex): Promise<BinaryPositionIds>;
  getPositionBalance(wallet: Address, positionId: bigint): Promise<bigint>;
  simulateSplit(wallet: Address, oracle: Address, questionId: Hex, amount: bigint): Promise<void>;
  estimateSplit(wallet: Address, oracle: Address, questionId: Hex, amount: bigint): Promise<bigint>;
  submitSplit?: (wallet: Address, oracle: Address, questionId: Hex, amount: bigint) => Promise<Hex>;
  waitForReceipt?: (hash: Hex) => Promise<"success" | "reverted">;
};

export type SplitResult = {
  ctf: Address;
  collateral: Address;
  adapter: Address;
  wallet: Address;
  oracle: Address;
  questionId: Hex;
  conditionId: Hex;
  amount: bigint;
  tokenBalance: bigint;
  allowance: bigint;
  yesPositionId: bigint;
  noPositionId: bigint;
  yesBalanceBefore: bigint;
  noBalanceBefore: bigint;
  gasEstimate: bigint;
  submitted: boolean;
  transactionHash?: Hex;
  yesBalanceAfter?: bigint;
  noBalanceAfter?: bigint;
};

export class SepoliaSplitError extends Error {
  constructor(message: string, readonly transactionHash?: Hex) {
    super(message);
    this.name = "SepoliaSplitError";
  }
}

function fail(message: string): never {
  throw new SepoliaSplitError(message);
}

async function recheckBeforeSend(reader: SplitReader, initial: SplitResult): Promise<void> {
  let chainId: number;
  let tokenBalance: bigint;
  let allowance: bigint;
  let slots: bigint;
  let payoutDenominator: bigint;
  let adapterCtf: Address;
  let adapterCollateral: Address;
  try {
    [chainId, tokenBalance, allowance, slots, payoutDenominator, adapterCtf, adapterCollateral] = await Promise.all([
      reader.getChainId(),
      reader.getTokenBalance(initial.wallet),
      reader.getAllowance(initial.wallet),
      reader.getOutcomeSlotCount(initial.conditionId),
      reader.getPayoutDenominator(initial.conditionId),
      reader.getAdapterCtf(),
      reader.getAdapterCollateral(),
    ]);
  } catch {
    fail("Pre-submit state recheck failed; provider details were withheld and no split was sent.");
  }
  if (chainId !== 11155111) fail("Network changed from Sepolia; no split was sent.");
  if (adapterCtf.toLowerCase() !== initial.ctf.toLowerCase() ||
      adapterCollateral.toLowerCase() !== initial.collateral.toLowerCase()) {
    fail("Adapter configuration changed after preflight; no split was sent.");
  }
  if (slots !== 2n || payoutDenominator !== 0n) {
    fail("Condition is no longer prepared and unresolved as expected; no split was sent.");
  }
  if (tokenBalance < initial.amount || allowance < initial.amount) {
    fail("MOCK balance or allowance is now below 1 MOCK; no split was sent.");
  }
  if (tokenBalance !== initial.tokenBalance || allowance !== initial.allowance) {
    fail("MOCK balance or allowance changed after the displayed preflight; rerun and review before splitting.");
  }
}

export async function runSepoliaBinarySplit(
  wallet: Address,
  oracle: Address,
  record: { questionId: Hex; conditionId: Hex; ctfAddress: Address },
  requestConfirmation: (() => Promise<string>) | undefined,
  reader: SplitReader,
  artifact: {
    ctfRuntime: Hex;
    collateralRuntime: Hex;
    adapterRuntime: Hex;
    adapterImmutableReferences: readonly ImmutableReference[];
  },
  onPreflight?: (result: SplitResult) => void,
): Promise<SplitResult> {
  if (wallet.toLowerCase() !== SPLIT_WALLET.toLowerCase()) fail("Wallet does not match the expected Sepolia test wallet.");
  if (oracle.toLowerCase() !== SPLIT_WALLET.toLowerCase()) fail("Oracle does not match the saved condition oracle and expected wallet.");
  if (record.questionId.toLowerCase() !== SPLIT_QUESTION_ID.toLowerCase() ||
      record.conditionId.toLowerCase() !== SPLIT_CONDITION_ID.toLowerCase() ||
      record.ctfAddress.toLowerCase() !== INTEGRATION_ADDRESSES.ctf.toLowerCase()) {
    fail("Saved condition identity does not match the approved Question ID, Condition ID, and CTF address.");
  }

  let chainId: number;
  try {
    chainId = await reader.getChainId();
  } catch {
    fail("Sepolia chain-ID read failed; provider details were withheld.");
  }
  if (chainId !== 11155111) fail(`RPC chain ID is ${chainId}; expected Sepolia 11155111.`);

  let ctfCode: Hex | undefined;
  let collateralCode: Hex | undefined;
  let adapterCode: Hex | undefined;
  try {
    [ctfCode, collateralCode, adapterCode] = await Promise.all([
      reader.getCode(INTEGRATION_ADDRESSES.ctf),
      reader.getCode(INTEGRATION_ADDRESSES.collateral),
      reader.getCode(INTEGRATION_ADDRESSES.adapter),
    ]);
  } catch {
    fail("CTF, collateral, or adapter code lookup failed; provider details were withheld.");
  }
  if (!ctfCode || ctfCode === "0x") fail("ConditionalTokens has no code at the expected Sepolia address.");
  if (!collateralCode || collateralCode === "0x") fail("MockCollateral has no code at the expected Sepolia address.");
  if (!adapterCode || adapterCode === "0x") fail("LocalCTFAdapter has no code at the expected Sepolia address.");
  if (ctfCode.toLowerCase() !== artifact.ctfRuntime.toLowerCase() ||
      collateralCode.toLowerCase() !== artifact.collateralRuntime.toLowerCase()) {
    fail("CTF or MockCollateral runtime does not match its pinned local artifact.");
  }
  if (adapterCode.length !== artifact.adapterRuntime.length ||
      maskImmutables(adapterCode, artifact.adapterImmutableReferences) !==
        maskImmutables(artifact.adapterRuntime, artifact.adapterImmutableReferences)) {
    fail("LocalCTFAdapter runtime does not match its pinned artifact outside compiler-recorded immutables.");
  }

  let adapterCtf: Address;
  let adapterCollateral: Address;
  let conditionId: Hex;
  let slots: bigint;
  let denominator: bigint;
  let decimals: number;
  let tokenBalance: bigint;
  let allowance: bigint;
  let positions: BinaryPositionIds;
  try {
    [adapterCtf, adapterCollateral, conditionId, decimals, tokenBalance, allowance, positions] = await Promise.all([
      reader.getAdapterCtf(),
      reader.getAdapterCollateral(),
      reader.getConditionId(),
      reader.getTokenDecimals(),
      reader.getTokenBalance(wallet),
      reader.getAllowance(wallet),
      reader.getPositionIds(oracle, record.questionId),
    ]);
    [slots, denominator] = await Promise.all([
      reader.getOutcomeSlotCount(conditionId),
      reader.getPayoutDenominator(conditionId),
    ]);
  } catch {
    fail("Adapter, token, or condition state read failed; provider details were withheld.");
  }
  if (adapterCtf.toLowerCase() !== INTEGRATION_ADDRESSES.ctf.toLowerCase() ||
      adapterCollateral.toLowerCase() !== INTEGRATION_ADDRESSES.collateral.toLowerCase()) {
    fail("Adapter ctf() or collateral() does not match the expected deployed contracts.");
  }
  if (conditionId.toLowerCase() !== record.conditionId.toLowerCase() ||
      positions.conditionId.toLowerCase() !== record.conditionId.toLowerCase()) {
    fail("Official CTF, adapter, and saved record condition IDs do not match.");
  }
  if (decimals !== 18) fail("MockCollateral decimals are not 18; refusing the fixed 1 MOCK operation.");
  if (slots !== 2n) fail(`Condition is not prepared as binary (outcome slot count ${slots}).`);
  if (denominator !== 0n) fail("Condition is already resolved; refusing to split into a resolved condition.");
  if (tokenBalance < SPLIT_AMOUNT) fail("Wallet MOCK balance is below 1 MOCK.");
  if (allowance < SPLIT_AMOUNT) fail("Wallet ERC-20 allowance to the adapter is below 1 MOCK.");

  let yesBalanceBefore: bigint;
  let noBalanceBefore: bigint;
  try {
    [yesBalanceBefore, noBalanceBefore] = await Promise.all([
      reader.getPositionBalance(wallet, positions.yesPositionId),
      reader.getPositionBalance(wallet, positions.noPositionId),
    ]);
  } catch {
    fail("YES/NO position balance read failed; provider details were withheld.");
  }
  try {
    await reader.simulateSplit(wallet, oracle, record.questionId, SPLIT_AMOUNT);
  } catch {
    fail("Exact split simulation failed; no transaction was sent and provider details were withheld.");
  }
  let gasEstimate: bigint;
  try {
    gasEstimate = await reader.estimateSplit(wallet, oracle, record.questionId, SPLIT_AMOUNT);
  } catch {
    fail("Split gas estimate failed; no transaction was sent and provider details were withheld.");
  }

  const result: SplitResult = {
    ctf: INTEGRATION_ADDRESSES.ctf,
    collateral: INTEGRATION_ADDRESSES.collateral,
    adapter: INTEGRATION_ADDRESSES.adapter,
    wallet,
    oracle,
    questionId: record.questionId,
    conditionId,
    amount: SPLIT_AMOUNT,
    tokenBalance,
    allowance,
    yesPositionId: positions.yesPositionId,
    noPositionId: positions.noPositionId,
    yesBalanceBefore,
    noBalanceBefore,
    gasEstimate,
    submitted: false,
  };
  onPreflight?.(result);
  if (!requestConfirmation) return result;
  let confirmation: string;
  try {
    confirmation = await requestConfirmation();
  } catch {
    fail("Confirmation input failed; no split was sent.");
  }
  if (confirmation !== SPLIT_CONFIRMATION) {
    fail(`Confirmation did not match. Exact required phrase: ${SPLIT_CONFIRMATION}`);
  }
  if (!reader.submitSplit || !reader.waitForReceipt) fail("Confirmed split requested but no transaction sender is configured.");

  await recheckBeforeSend(reader, result);
  try {
    await reader.simulateSplit(wallet, oracle, record.questionId, SPLIT_AMOUNT);
  } catch {
    fail("Final split simulation failed; no transaction was sent and provider details were withheld.");
  }

  let hash: Hex;
  try {
    hash = await reader.submitSplit(wallet, oracle, record.questionId, SPLIT_AMOUNT);
    result.transactionHash = hash;
  } catch (error) {
    if (error instanceof SepoliaSplitError) throw error;
    fail("Split submission failed without a confirmed transaction hash; broadcast status may be unknown. Check before retrying; provider details were withheld.");
  }

  let receiptStatus: "success" | "reverted";
  try {
    receiptStatus = await reader.waitForReceipt(hash);
  } catch {
    throw new SepoliaSplitError("Could not confirm the split receipt; check this transaction hash before retrying.", hash);
  }
  if (receiptStatus !== "success") throw new SepoliaSplitError("Split receipt indicates failure.", hash);

  let yesBalanceAfter: bigint;
  let noBalanceAfter: bigint;
  try {
    [yesBalanceAfter, noBalanceAfter] = await Promise.all([
      reader.getPositionBalance(wallet, positions.yesPositionId),
      reader.getPositionBalance(wallet, positions.noPositionId),
    ]);
  } catch {
    throw new SepoliaSplitError("Split receipt succeeded, but YES/NO balance verification failed.", hash);
  }
  if (yesBalanceAfter < yesBalanceBefore + SPLIT_AMOUNT ||
      noBalanceAfter < noBalanceBefore + SPLIT_AMOUNT) {
    throw new SepoliaSplitError("Split receipt succeeded, but wallet did not receive at least 1 of each outcome position.", hash);
  }
  result.submitted = true;
  result.transactionHash = hash;
  result.yesBalanceAfter = yesBalanceAfter;
  result.noBalanceAfter = noBalanceAfter;
  return result;
}
