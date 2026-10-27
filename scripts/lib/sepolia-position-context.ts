import type { Address, Hex } from "viem";
import {
  INTEGRATION_ADDRESSES,
  maskImmutables,
  type ImmutableReference,
} from "./sepolia-integration-preflight.js";
import { SPLIT_CONDITION_ID, SPLIT_QUESTION_ID, SPLIT_WALLET } from "./sepolia-binary-split.js";

export type SavedPositionCondition = {
  ctfAddress: Address;
  oracle: Address;
  questionId: Hex;
  conditionId: Hex;
};

export type PositionIds = {
  conditionId: Hex;
  yesPositionId: bigint;
  noPositionId: bigint;
};

export type PositionContextReader = {
  getChainId(): Promise<number>;
  getCode(address: Address): Promise<Hex | undefined>;
  getAdapterCtf(): Promise<Address>;
  getAdapterCollateral(): Promise<Address>;
  getOfficialConditionId(oracle: Address, questionId: Hex): Promise<Hex>;
  getOutcomeSlotCount(conditionId: Hex): Promise<bigint>;
  getPayoutDenominator(conditionId: Hex): Promise<bigint>;
  getPositionIds(oracle: Address, questionId: Hex): Promise<PositionIds>;
};

export type PositionArtifacts = {
  ctfRuntime: Hex;
  collateralRuntime: Hex;
  adapterRuntime: Hex;
  adapterImmutableReferences: readonly ImmutableReference[];
};

export type PositionContext = {
  ctf: Address;
  collateral: Address;
  adapter: Address;
  wallet: Address;
  oracle: Address;
  questionId: Hex;
  conditionId: Hex;
  yesPositionId: bigint;
  noPositionId: bigint;
};

export class PositionContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PositionContextError";
  }
}

function fail(message: string): never {
  throw new PositionContextError(message);
}

export async function verifyPositionContext(
  wallet: Address,
  record: SavedPositionCondition,
  reader: PositionContextReader,
  artifacts: PositionArtifacts,
): Promise<PositionContext> {
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
  let officialConditionId: Hex;
  let slots: bigint;
  let payoutDenominator: bigint;
  let positionIds: PositionIds;
  try {
    [adapterCtf, adapterCollateral, officialConditionId] = await Promise.all([
      reader.getAdapterCtf(),
      reader.getAdapterCollateral(),
      reader.getOfficialConditionId(record.oracle, record.questionId),
    ]);
    [slots, payoutDenominator, positionIds] = await Promise.all([
      reader.getOutcomeSlotCount(officialConditionId),
      reader.getPayoutDenominator(officialConditionId),
      reader.getPositionIds(record.oracle, record.questionId),
    ]);
  } catch {
    fail("Adapter or CTF condition read failed; provider details were withheld.");
  }
  if (adapterCtf.toLowerCase() !== INTEGRATION_ADDRESSES.ctf.toLowerCase() ||
      adapterCollateral.toLowerCase() !== INTEGRATION_ADDRESSES.collateral.toLowerCase()) {
    fail("Adapter ctf() or collateral() does not match the expected deployed addresses.");
  }
  if (officialConditionId.toLowerCase() !== record.conditionId.toLowerCase() ||
      positionIds.conditionId.toLowerCase() !== record.conditionId.toLowerCase()) {
    fail("Official CTF, adapter position IDs, and saved condition record disagree.");
  }
  if (slots !== 2n) fail(`Original condition is not prepared as binary (outcome slot count ${slots}).`);
  if (payoutDenominator !== 0n) fail("Original condition is resolved; these commands require it to remain unresolved.");

  return {
    ctf: INTEGRATION_ADDRESSES.ctf,
    collateral: INTEGRATION_ADDRESSES.collateral,
    adapter: INTEGRATION_ADDRESSES.adapter,
    wallet,
    oracle: record.oracle,
    questionId: record.questionId,
    conditionId: officialConditionId,
    yesPositionId: positionIds.yesPositionId,
    noPositionId: positionIds.noPositionId,
  };
}
