import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { network } from "hardhat";

describe("complete local lifecycle with official Gnosis CTF", async function () {
  const { viem } = await network.create();
  const [oracle, user, losingHolder] = await viem.getWalletClients();
  const questionId = `0x${"33".repeat(32)}` as `0x${string}`;
  const unpreparedQuestionId = `0x${"44".repeat(32)}` as `0x${string}`;
  const oneToken = 10n ** 18n;
  const tenTokens = 10n * oneToken;
  const elevenTokens = 11n * oneToken;
  const userStartingCollateral = 50n * oneToken;

  let ctf: Awaited<ReturnType<typeof viem.deployContract<"ConditionalTokens">>>;
  let collateral: Awaited<ReturnType<typeof viem.deployContract<"MockCollateral">>>;
  let adapter: Awaited<ReturnType<typeof viem.deployContract<"LocalCTFAdapter">>>;
  let conditionId: `0x${string}`;
  let yesPositionId: bigint;
  let noPositionId: bigint;

  // deploy the real ctf locally and prepare one fresh binary condition.
  beforeEach(async function () {
    ctf = await viem.deployContract("ConditionalTokens");
    collateral = await viem.deployContract("MockCollateral");
    adapter = await viem.deployContract("LocalCTFAdapter", [
      ctf.address,
      collateral.address,
    ]);

    await collateral.write.transfer([user.account.address, userStartingCollateral]);
    await ctf.write.prepareCondition([oracle.account.address, questionId, 2n]);

    const ids = await adapter.read.getBinaryPositionIds([
      oracle.account.address,
      questionId,
    ]);
    conditionId = ids[0];
    yesPositionId = ids[3];
    noPositionId = ids[4];
  });

  // prove preparation, collateral ownership, approval, split, and final custody.
  it("prepares and splits a binary condition through the adapter", async function () {
    assert.equal(await ctf.read.getOutcomeSlotCount([conditionId]), 2n);
    assert.equal(await ctf.read.payoutDenominator([conditionId]), 0n);
    assert.equal(
      await collateral.read.balanceOf([user.account.address]),
      userStartingCollateral,
    );
    assert.equal(
      await collateral.read.allowance([user.account.address, adapter.address]),
      0n,
    );

    await collateral.write.approve([adapter.address, tenTokens], {
      account: user.account,
    });
    assert.equal(
      await collateral.read.allowance([user.account.address, adapter.address]),
      tenTokens,
    );

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

  // prove matching positions return collateral to the same user.
  it("merges a complete pair and returns collateral to the user", async function () {
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

  // prove a request larger than both owned balances fails atomically.
  it("rejects merging with insufficient outcome balances", async function () {
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
      adapter.write.mergeBinary(
        [oracle.account.address, questionId, elevenTokens],
        { account: user.account },
      ),
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

  // official ctf derives the condition from msg.sender, so another account cannot resolve it.
  it("rejects payout reporting by an unauthorized oracle", async function () {
    await assert.rejects(
      ctf.write.reportPayouts([questionId, [1n, 0n]], {
        account: user.account,
      }),
    );

    assert.equal(await ctf.read.payoutDenominator([conditionId]), 0n);

    await ctf.write.reportPayouts([questionId, [1n, 0n]], {
      account: oracle.account,
    });
    assert.equal(await ctf.read.payoutDenominator([conditionId]), 1n);
  });

  // the official ctf rejects invalid payout vectors without resolving the condition.
  it("rejects all-zero and wrong-length payout vectors", async function () {
    await assert.rejects(
      ctf.write.reportPayouts([questionId, [0n, 0n]], {
        account: oracle.account,
      }),
    );
    assert.equal(await ctf.read.payoutDenominator([conditionId]), 0n);

    await assert.rejects(
      ctf.write.reportPayouts([questionId, [1n]], {
        account: oracle.account,
      }),
    );
    assert.equal(await ctf.read.payoutDenominator([conditionId]), 0n);
  });

  // an unknown question has no prepared condition and cannot be split.
  it("rejects an unprepared condition", async function () {
    const unpreparedConditionId = await adapter.read.getBinaryConditionId([
      oracle.account.address,
      unpreparedQuestionId,
    ]);

    await viem.assertions.revertWithCustomErrorWithArgs(
      adapter.write.splitBinary(
        [oracle.account.address, unpreparedQuestionId, oneToken],
        { account: user.account },
      ),
      adapter,
      "InvalidBinaryCondition",
      [unpreparedConditionId, 0n],
    );

    assert.equal(
      await collateral.read.balanceOf([user.account.address]),
      userStartingCollateral,
    );
  });

  // a failed early redemption must return every temporarily moved asset.
  it("rejects redemption before resolution without changing custody", async function () {
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

  // separate holders prove the winner receives 10 and the loser receives zero.
  it("pays the yes holder and gives the losing no holder no collateral", async function () {
    await collateral.write.approve([adapter.address, tenTokens], {
      account: user.account,
    });
    await adapter.write.splitBinary(
      [oracle.account.address, questionId, tenTokens],
      { account: user.account },
    );

    await ctf.write.safeTransferFrom(
      [
        user.account.address,
        losingHolder.account.address,
        noPositionId,
        tenTokens,
        "0x",
      ],
      { account: user.account },
    );
    assert.equal(await ctf.read.balanceOf([user.account.address, yesPositionId]), tenTokens);
    assert.equal(await ctf.read.balanceOf([user.account.address, noPositionId]), 0n);
    assert.equal(await ctf.read.balanceOf([losingHolder.account.address, noPositionId]), tenTokens);

    await ctf.write.setApprovalForAll([adapter.address, true], {
      account: user.account,
    });
    await ctf.write.setApprovalForAll([adapter.address, true], {
      account: losingHolder.account,
    });
    await ctf.write.reportPayouts([questionId, [1n, 0n]], {
      account: oracle.account,
    });

    await adapter.write.redeemBinary([oracle.account.address, questionId], {
      account: user.account,
    });
    await adapter.write.redeemBinary([oracle.account.address, questionId], {
      account: losingHolder.account,
    });

    assert.equal(
      await collateral.read.balanceOf([user.account.address]),
      userStartingCollateral,
    );
    assert.equal(await collateral.read.balanceOf([losingHolder.account.address]), 0n);
    assert.equal(await collateral.read.balanceOf([ctf.address]), 0n);
    assert.equal(await collateral.read.balanceOf([adapter.address]), 0n);
    assert.equal(await ctf.read.balanceOf([user.account.address, yesPositionId]), 0n);
    assert.equal(await ctf.read.balanceOf([losingHolder.account.address, noPositionId]), 0n);
    assert.equal(await ctf.read.balanceOf([adapter.address, yesPositionId]), 0n);
    assert.equal(await ctf.read.balanceOf([adapter.address, noPositionId]), 0n);
  });
});
