import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { encodePacked, keccak256 } from "viem";
import { network } from "hardhat";

describe("EducationalCTIdHelpers", async function () {
  const { viem } = await network.create();
  const [oracle, otherAccount] = await viem.getWalletClients();
  const zeroParent = `0x${"00".repeat(32)}` as `0x${string}`;
  const binaryQuestionId = `0x${"00".repeat(31)}01` as `0x${string}`;

  let harness: Awaited<ReturnType<typeof viem.deployContract>>;
  let collateral: Awaited<ReturnType<typeof viem.deployContract>>;

  before(async function () {
    harness = await viem.deployContract("EducationalCTIdHarness");
    collateral = await viem.deployContract("MockCollateral");
  });

  // compare all three calculations with fixed values from official ctf docs.
  it("matches the official categorical example", async function () {
    const officialOracle = "0x1337aBcdef1337abCdEf1337ABcDeF1337AbcDeF";
    const officialQuestion =
      "0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabc1234";
    const expectedCondition =
      "0x67eb23e8932765c1d7a094838c928476df8c50d1d3898f278ef1fb2a62afab63";
    const expectedCollection =
      "0x229b067e142fce0aea84afb935095c6ecbea8647b8a013e795cc0ced3210a3d5";
    const officialCollateral = "0xD011ad011ad011AD011ad011Ad011Ad011Ad011A";
    const expectedPosition =
      0x5355fd8106a08b14aedf99935210b2c22a7f92abaf8bb00b60fcece1032436b7n;

    const conditionId = await harness.read.getConditionId([
      officialOracle,
      officialQuestion,
      3n,
    ]);
    const collectionId = await harness.read.getCollectionId([
      zeroParent,
      conditionId,
      0b011n,
    ]);
    const positionId = await harness.read.getPositionId([
      officialCollateral,
      collectionId,
    ]);

    assert.equal(conditionId, expectedCondition);
    assert.equal(collectionId, expectedCollection);
    assert.equal(positionId, expectedPosition);
  });

  // the same typed inputs must always return the same condition id.
  it("calculates a deterministic binary condition id", async function () {
    const first = await harness.read.getConditionId([
      oracle.account.address,
      binaryQuestionId,
      2n,
    ]);
    const second = await harness.read.getConditionId([
      oracle.account.address,
      binaryQuestionId,
      2n,
    ]);
    const independentlyPacked = keccak256(
      encodePacked(
        ["address", "bytes32", "uint256"],
        [oracle.account.address, binaryQuestionId, 2n],
      ),
    );

    assert.equal(first, second);
    assert.equal(first, independentlyPacked);
  });

  // changing the oracle changes the condition id.
  it("creates a different condition id for different input", async function () {
    const first = await harness.read.getConditionId([
      oracle.account.address,
      binaryQuestionId,
      2n,
    ]);
    const second = await harness.read.getConditionId([
      otherAccount.account.address,
      binaryQuestionId,
      2n,
    ]);

    assert.notEqual(first, second);
  });

  // yes and no use different index-set bits, so their collection ids differ.
  it("creates separate yes and no collection ids", async function () {
    const conditionId = await harness.read.getConditionId([
      oracle.account.address,
      binaryQuestionId,
      2n,
    ]);
    const yesCollectionId = await harness.read.getCollectionId([
      zeroParent,
      conditionId,
      0b01n,
    ]);
    const noCollectionId = await harness.read.getCollectionId([
      zeroParent,
      conditionId,
      0b10n,
    ]);

    assert.notEqual(yesCollectionId, noCollectionId);
    assert.equal(
      yesCollectionId,
      await harness.read.getCollectionId([zeroParent, conditionId, 0b01n]),
    );
  });

  // a position id must bind one collection to one collateral token address.
  it("derives position ids from collateral and collection ids", async function () {
    const conditionId = await harness.read.getConditionId([
      oracle.account.address,
      binaryQuestionId,
      2n,
    ]);
    const yesCollectionId = await harness.read.getCollectionId([
      zeroParent,
      conditionId,
      0b01n,
    ]);
    const noCollectionId = await harness.read.getCollectionId([
      zeroParent,
      conditionId,
      0b10n,
    ]);
    const yesPositionId = await harness.read.getPositionId([
      collateral.address,
      yesCollectionId,
    ]);
    const noPositionId = await harness.read.getPositionId([
      collateral.address,
      noCollectionId,
    ]);
    const independentlyPacked = BigInt(
      keccak256(
        encodePacked(
          ["address", "bytes32"],
          [collateral.address, yesCollectionId],
        ),
      ),
    );

    assert.equal(yesPositionId, independentlyPacked);
    assert.notEqual(yesPositionId, noPositionId);
  });

  // this small port rejects nested collections instead of calculating them wrongly.
  it("clearly rejects an unsupported parent collection", async function () {
    const conditionId = await harness.read.getConditionId([
      oracle.account.address,
      binaryQuestionId,
      2n,
    ]);

    await viem.assertions.revertWithCustomError(
      harness.read.getCollectionId([binaryQuestionId, conditionId, 0b01n]),
      harness,
      "UnsupportedParentCollection",
    );
  });
});
