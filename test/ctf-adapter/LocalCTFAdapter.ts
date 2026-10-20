import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { network } from "hardhat";

describe("LocalCTFAdapter with the actual CTF contract", async function () {
  const { viem } = await network.create();
  const [oracle, user] = await viem.getWalletClients();
  const questionId = `0x${"11".repeat(32)}` as `0x${string}`;
  const otherQuestionId = `0x${"22".repeat(32)}` as `0x${string}`;
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  const oneToken = 10n ** 18n;
  const tenTokens = 10n * oneToken;
  const userStartingCollateral = 50n * oneToken;

  let ctf: Awaited<ReturnType<typeof viem.deployContract>>;
  let collateral: Awaited<ReturnType<typeof viem.deployContract>>;
  let adapter: Awaited<ReturnType<typeof viem.deployContract>>;

  // deploy the official ctf, local collateral, and modern adapter for every test.
  beforeEach(async function () {
    ctf = await viem.deployContract("ConditionalTokens");
    collateral = await viem.deployContract("MockCollateral");
    adapter = await viem.deployContract("LocalCTFAdapter", [
      ctf.address,
      collateral.address,
    ]);

    await collateral.write.transfer([user.account.address, userStartingCollateral]);
    await ctf.write.prepareCondition([oracle.account.address, questionId, 2n]);
  });

  // the constructor must not accept a missing ctf address.
  it("rejects a zero ctf address", async function () {
    await viem.assertions.revertWithCustomError(
      viem.deployContract("LocalCTFAdapter", [zeroAddress, collateral.address]),
      adapter,
      "ZeroAddress",
    );
  });

  // splitting explicitly moves collateral through the adapter and outcomes to the user.
  it("splits through the actual ctf and forwards both positions", async function () {
    const ids = await adapter.read.getBinaryPositionIds([
      oracle.account.address,
      questionId,
    ]);
    const yesPositionId = ids[3];
    const noPositionId = ids[4];

    await collateral.write.approve([adapter.address, tenTokens], {
      account: user.account,
    });
    await adapter.write.splitBinary(
      [oracle.account.address, questionId, tenTokens],
      { account: user.account },
    );

    assert.equal(
      await collateral.read.balanceOf([user.account.address]),
      userStartingCollateral - tenTokens,
    );
    assert.equal(await collateral.read.balanceOf([ctf.address]), tenTokens);
    assert.equal(await collateral.read.balanceOf([adapter.address]), 0n);
    assert.equal(await ctf.read.balanceOf([user.account.address, yesPositionId]), tenTokens);
    assert.equal(await ctf.read.balanceOf([user.account.address, noPositionId]), tenTokens);
    assert.equal(await ctf.read.balanceOf([adapter.address, yesPositionId]), 0n);
    assert.equal(await ctf.read.balanceOf([adapter.address, noPositionId]), 0n);
  });

  // the adapter cannot take collateral unless the user approves it first.
  it("rejects splitting without collateral approval", async function () {
    await assert.rejects(
      adapter.write.splitBinary(
        [oracle.account.address, questionId, tenTokens],
        { account: user.account },
      ),
    );

    assert.equal(
      await collateral.read.balanceOf([user.account.address]),
      userStartingCollateral,
    );
  });

  // reject zero amounts and conditions that were not prepared as binary.
  it("rejects invalid split inputs", async function () {
    await viem.assertions.revertWithCustomError(
      adapter.write.splitBinary([oracle.account.address, questionId, 0n], {
        account: user.account,
      }),
      adapter,
      "ZeroAmount",
    );

    const unpreparedCondition = await adapter.read.getBinaryConditionId([
      oracle.account.address,
      otherQuestionId,
    ]);
    await viem.assertions.revertWithCustomErrorWithArgs(
      adapter.write.splitBinary(
        [oracle.account.address, otherQuestionId, oneToken],
        { account: user.account },
      ),
      adapter,
      "InvalidBinaryCondition",
      [unpreparedCondition, 0n],
    );
  });

  // merging requires the user's separate erc-1155 operator approval.
  it("rejects merging without outcome-token approval", async function () {
    await collateral.write.approve([adapter.address, tenTokens], {
      account: user.account,
    });
    await adapter.write.splitBinary(
      [oracle.account.address, questionId, tenTokens],
      { account: user.account },
    );

    await assert.rejects(
      adapter.write.mergeBinary(
        [oracle.account.address, questionId, tenTokens],
        { account: user.account },
      ),
    );
  });

  // an approved complete pair is merged and collateral is explicitly returned.
  it("merges through the actual ctf and returns collateral", async function () {
    const ids = await adapter.read.getBinaryPositionIds([
      oracle.account.address,
      questionId,
    ]);
    const yesPositionId = ids[3];
    const noPositionId = ids[4];

    await collateral.write.approve([adapter.address, tenTokens], {
      account: user.account,
    });
    await adapter.write.splitBinary(
      [oracle.account.address, questionId, tenTokens],
      { account: user.account },
    );
    await ctf.write.setApprovalForAll([adapter.address, true], {
      account: user.account,
    });

    await adapter.write.mergeBinary(
      [oracle.account.address, questionId, tenTokens],
      { account: user.account },
    );

    assert.equal(
      await collateral.read.balanceOf([user.account.address]),
      userStartingCollateral,
    );
    assert.equal(await collateral.read.balanceOf([ctf.address]), 0n);
    assert.equal(await collateral.read.balanceOf([adapter.address]), 0n);
    assert.equal(await ctf.read.balanceOf([user.account.address, yesPositionId]), 0n);
    assert.equal(await ctf.read.balanceOf([user.account.address, noPositionId]), 0n);
  });

  // ctf itself refuses redemption before its oracle reports a payout.
  it("rejects redemption before the actual ctf condition resolves", async function () {
    const ids = await adapter.read.getBinaryPositionIds([
      oracle.account.address,
      questionId,
    ]);
    const yesPositionId = ids[3];
    const noPositionId = ids[4];

    await collateral.write.approve([adapter.address, tenTokens], {
      account: user.account,
    });
    await adapter.write.splitBinary(
      [oracle.account.address, questionId, tenTokens],
      { account: user.account },
    );
    await ctf.write.setApprovalForAll([adapter.address, true], {
      account: user.account,
    });

    await assert.rejects(
      adapter.write.redeemBinary([oracle.account.address, questionId], {
        account: user.account,
      }),
    );

    assert.equal(await ctf.read.balanceOf([user.account.address, yesPositionId]), tenTokens);
    assert.equal(await ctf.read.balanceOf([user.account.address, noPositionId]), tenTokens);
  });

  // after the official oracle reports yes, redemption pays and forwards collateral.
  it("redeems a yes win through the actual ctf", async function () {
    const ids = await adapter.read.getBinaryPositionIds([
      oracle.account.address,
      questionId,
    ]);
    const yesPositionId = ids[3];
    const noPositionId = ids[4];

    await collateral.write.approve([adapter.address, tenTokens], {
      account: user.account,
    });
    await adapter.write.splitBinary(
      [oracle.account.address, questionId, tenTokens],
      { account: user.account },
    );
    await ctf.write.setApprovalForAll([adapter.address, true], {
      account: user.account,
    });

    await ctf.write.reportPayouts([questionId, [1n, 0n]]);
    await adapter.write.redeemBinary([oracle.account.address, questionId], {
      account: user.account,
    });

    assert.equal(
      await collateral.read.balanceOf([user.account.address]),
      userStartingCollateral,
    );
    assert.equal(await collateral.read.balanceOf([ctf.address]), 0n);
    assert.equal(await collateral.read.balanceOf([adapter.address]), 0n);
    assert.equal(await ctf.read.balanceOf([user.account.address, yesPositionId]), 0n);
    assert.equal(await ctf.read.balanceOf([user.account.address, noPositionId]), 0n);
  });
});
