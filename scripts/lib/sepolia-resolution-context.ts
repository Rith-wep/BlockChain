import type { Address, Hex } from "viem";
import {
  INTEGRATION_ADDRESSES,
  maskImmutables,
  type ImmutableReference,
} from "./sepolia-integration-preflight.js";
import {
  SPLIT_CONDITION_ID,
  SPLIT_QUESTION_ID,
  SPLIT_WALLET,
} from "./sepolia-binary-split.js";

export type ResolutionRecord = {
  ctfAddress: Address;
  oracle: Address;
  questionId: Hex;
  conditionId: Hex;
};

export type ResolutionPositionIds = {
  conditionId: Hex;
  yesPositionId: bigint;
  noPositionId: bigint;
};

export type ResolutionReader = {
  getChainId(): Promise<number>;
  getCode(address: Address): Promise<Hex | undefined>;
  getAdapterCtf(): Promise<Address>;
  getAdapterCollateral(): Promise<Address>;
  getOfficialConditionId(oracle: Address, questionId: Hex): Promise<Hex>;
  getOutcomeSlotCount(conditionId: Hex): Promise<bigint>;
  getPayoutDenominator(conditionId: Hex): Promise<bigint>;
  getPayoutNumerator(conditionId: Hex, outcomeIndex: bigint): Promise<bigint>;
  getPositionIds(oracle: Address, questionId: Hex): Promise<ResolutionPositionIds>;
  getCollateralBalance(wallet: Address): Promise<bigint>;
  getPositionBalance(wallet: Address, positionId: bigint): Promise<bigint>;
  getOperatorApproval(wallet: Address, operator: Address): Promise<boolean>;
};

export type ResolutionArtifacts = {
  ctfRuntime: Hex;
  collateralRuntime: Hex;
  adapterRuntime: Hex;
  adapterImmutableReferences: readonly ImmutableReference[];
};

export type ResolutionContext = {
  ctf: Address;
  collateral: Address;
  adapter: Address;
  wallet: Address;
  oracle: Address;
  questionId: Hex;
  conditionId: Hex;
  outcomeSlotCount: bigint;
  payoutDenominator: bigint;
  payoutNumerators: readonly [bigint, bigint];
  yesPositionId: bigint;
  noPositionId: bigint;
  yesBalance: bigint;
  noBalance: bigint;
  collateralBalance: bigint;
  operatorApproved: boolean;
};

export class ResolutionContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolutionContextError";
  }
}

function fail(message: string): never {
  throw new ResolutionContextError(message);
}

export async function readResolutionContext(
  wallet: Address,
  record: ResolutionRecord,
  reader: ResolutionReader,
  artifacts: ResolutionArtifacts,
): Promise<ResolutionContext> {
  if (wallet.toLowerCase() !== SPLIT_WALLET.toLowerCase()) fail("Wallet does not match the expected Sepolia test wallet.");
  if (record.ctfAddress.toLowerCase() !== INTEGRATION_ADDRESSES.ctf.toLowerCase() ||
      record.oracle.toLowerCase() !== SPLIT_WALLET.toLowerCase() ||
      record.questionId.toLowerCase() !== SPLIT_QUESTION_ID.toLowerCase() ||
      record.conditionId.toLowerCase() !== SPLIT_CONDITION_ID.toLowerCase()) {
    fail("Saved condition record does not match the expected CTF, oracle, Question ID, and Condition ID.");
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
  if (ctfCode.toLowerCase() !== artifacts.ctfRuntime.toLowerCase() ||
      collateralCode.toLowerCase() !== artifacts.collateralRuntime.toLowerCase()) {
    fail("CTF or MockCollateral runtime does not match its pinned local artifact.");
  }
  if (adapterCode.length !== artifacts.adapterRuntime.length ||
      maskImmutables(adapterCode, artifacts.adapterImmutableReferences) !==
        maskImmutables(artifacts.adapterRuntime, artifacts.adapterImmutableReferences)) {
    fail("LocalCTFAdapter runtime does not match its pinned artifact outside compiler-recorded immutables.");
  }

  let adapterCtf: Address;
  let adapterCollateral: Address;
  let conditionId: Hex;
  let slots: bigint;
  let denominator: bigint;
  let numerators: readonly [bigint, bigint];
  let positions: ResolutionPositionIds;
  let collateralBalance: bigint;
  let yesBalance: bigint;
  let noBalance: bigint;
  let operatorApproved: boolean;
  try {
    [adapterCtf, adapterCollateral, conditionId] = await Promise.all([
      reader.getAdapterCtf(),
      reader.getAdapterCollateral(),
      reader.getOfficialConditionId(record.oracle, record.questionId),
    ]);
    [slots, denominator, positions, collateralBalance, operatorApproved] = await Promise.all([
      reader.getOutcomeSlotCount(conditionId),
      reader.getPayoutDenominator(conditionId),
      reader.getPositionIds(record.oracle, record.questionId),
      reader.getCollateralBalance(wallet),
      reader.getOperatorApproval(wallet, INTEGRATION_ADDRESSES.adapter),
    ]);
    numerators = await Promise.all([
      reader.getPayoutNumerator(conditionId, 0n),
      reader.getPayoutNumerator(conditionId, 1n),
    ]) as [bigint, bigint];
    [yesBalance, noBalance] = await Promise.all([
      reader.getPositionBalance(wallet, positions.yesPositionId),
      reader.getPositionBalance(wallet, positions.noPositionId),
    ]);
  } catch {
    fail("Adapter, condition, payout, or balance read failed; provider details were withheld.");
  }
  if (adapterCtf.toLowerCase() !== INTEGRATION_ADDRESSES.ctf.toLowerCase() ||
      adapterCollateral.toLowerCase() !== INTEGRATION_ADDRESSES.collateral.toLowerCase()) {
    fail("Adapter ctf() or collateral() does not match the expected deployed addresses.");
  }
  if (conditionId.toLowerCase() !== record.conditionId.toLowerCase() ||
      positions.conditionId.toLowerCase() !== record.conditionId.toLowerCase()) {
    fail("Official CTF, adapter position IDs, and saved condition record disagree.");
  }
  if (slots !== 2n) fail(`Original condition is not prepared as binary (outcome slot count ${slots}).`);

  return {
    ctf: INTEGRATION_ADDRESSES.ctf,
    collateral: INTEGRATION_ADDRESSES.collateral,
    adapter: INTEGRATION_ADDRESSES.adapter,
    wallet,
    oracle: record.oracle,
    questionId: record.questionId,
    conditionId,
    outcomeSlotCount: slots,
    payoutDenominator: denominator,
    payoutNumerators: numerators,
    yesPositionId: positions.yesPositionId,
    noPositionId: positions.noPositionId,
    yesBalance,
    noBalance,
    collateralBalance,
    operatorApproved,
  };
}
