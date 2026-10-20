import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { network } from "hardhat";

describe("EducationalCTFMock", async function () {
  const { viem } = await network.create();
  const [learner] = await viem.getWalletClients();
  const oneToken = 10n ** 18n;
  const tenTokens = 10n * oneToken;
  const initialCollateral = 100n * oneToken;

  let collateral: Awaited<ReturnType<typeof viem.deployContract>>;
  let ctf: Awaited<ReturnType<typeof viem.deployContract>>;

  // start each lesson with fresh collateral and an unresolved binary condition.
  beforeEach(async function () {
    collateral = await viem.deployContract("MockCollateral");
    ctf = await viem.deployContract("EducationalCTFMock", [collateral.address]);
    await collateral.write.approve([ctf.address, tenTokens]);
  });

  // splitting locks 10 collateral and creates 10 units of both outcomes.
  it("splits 10 collateral into yes and no positions", async function () {
    assert.equal(await collateral.read.balanceOf([learner.account.address]), initialCollateral);
    assert.equal(await collateral.read.balanceOf([ctf.address]), 0n);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 0n]), 0n);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 1n]), 0n);

    await ctf.write.splitPosition([tenTokens]);

    assert.equal(
      await collateral.read.balanceOf([learner.account.address]),
      initialCollateral - tenTokens,
    );
    assert.equal(await collateral.read.balanceOf([ctf.address]), tenTokens);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 0n]), tenTokens);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 1n]), tenTokens);
  });

  // merging burns a complete pair and unlocks all 10 collateral.
  it("merges matching positions back into collateral", async function () {
    await ctf.write.splitPosition([tenTokens]);

    assert.equal(await collateral.read.balanceOf([learner.account.address]), initialCollateral - tenTokens);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 0n]), tenTokens);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 1n]), tenTokens);

    await ctf.write.mergePositions([tenTokens]);

    assert.equal(await collateral.read.balanceOf([learner.account.address]), initialCollateral);
    assert.equal(await collateral.read.balanceOf([ctf.address]), 0n);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 0n]), 0n);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 1n]), 0n);
  });

  // merging more than the owned outcome balance must fail.
  it("rejects a merge without enough outcome tokens", async function () {
    await ctf.write.splitPosition([tenTokens]);

    await viem.assertions.revertWithCustomErrorWithArgs(
      ctf.write.mergePositions([tenTokens + oneToken]),
      ctf,
      "ERC1155InsufficientBalance",
      [learner.account.address, tenTokens, tenTokens + oneToken, 0n],
    );

    assert.equal(await collateral.read.balanceOf([learner.account.address]), initialCollateral - tenTokens);
    assert.equal(await collateral.read.balanceOf([ctf.address]), tenTokens);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 0n]), tenTokens);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 1n]), tenTokens);
  });

  // positions cannot be redeemed until the oracle reports a result.
  it("rejects redemption before resolution", async function () {
    await ctf.write.splitPosition([tenTokens]);

    await viem.assertions.revertWithCustomError(
      ctf.write.redeemPositions(),
      ctf,
      "ConditionNotResolved",
    );

    assert.equal(await collateral.read.balanceOf([learner.account.address]), initialCollateral - tenTokens);
    assert.equal(await collateral.read.balanceOf([ctf.address]), tenTokens);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 0n]), tenTokens);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 1n]), tenTokens);
  });

  // after yes wins, yes pays collateral and both position balances are burned.
  it("redeems a yes-winning position after resolution", async function () {
    await ctf.write.splitPosition([tenTokens]);

    assert.equal(await ctf.read.resolved(), false);
    assert.equal(await collateral.read.balanceOf([learner.account.address]), initialCollateral - tenTokens);
    assert.equal(await collateral.read.balanceOf([ctf.address]), tenTokens);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 0n]), tenTokens);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 1n]), tenTokens);

    await ctf.write.reportPayouts([true]);

    assert.equal(await ctf.read.resolved(), true);
    assert.equal(await ctf.read.yesWins(), true);
    assert.equal(await collateral.read.balanceOf([learner.account.address]), initialCollateral - tenTokens);
    assert.equal(await collateral.read.balanceOf([ctf.address]), tenTokens);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 0n]), tenTokens);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 1n]), tenTokens);

    await ctf.write.redeemPositions();

    assert.equal(await collateral.read.balanceOf([learner.account.address]), initialCollateral);
    assert.equal(await collateral.read.balanceOf([ctf.address]), 0n);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 0n]), 0n);
    assert.equal(await ctf.read.balanceOf([learner.account.address, 1n]), 0n);
  });
});
