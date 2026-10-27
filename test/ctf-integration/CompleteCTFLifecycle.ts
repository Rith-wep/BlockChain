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
  const lifecycleQuestionId = `0x${"55".repeat(32)}` as `0x${string}`;

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

  // exercise one complete 1 MOCK lifecycle on fresh local contract instances.
  it("splits, resolves, and redeems one MOCK through the adapter", async function () {
    const initialBalance = await collateral.read.balanceOf([user.account.address]);
    const ids = await adapter.read.getBinaryPositionIds([
      oracle.account.address,
      lifecycleQuestionId,
    ]);
    const lifecycleConditionId = ids[0];
    const yesId = ids[3];
    const noId = ids[4];

    // Arrange: prepare a unique binary condition and verify it is unresolved.
    await ctf.write.prepareCondition([
      oracle.account.address,
      lifecycleQuestionId,
      2n,
    ]);
    assert.equal(await ctf.read.getOutcomeSlotCount([lifecycleConditionId]), 2n);
    assert.equal(await ctf.read.payoutDenominator([lifecycleConditionId]), 0n);
    assert.equal(await ctf.read.payoutNumerators([lifecycleConditionId, 0n]), 0n);
    assert.equal(await ctf.read.payoutNumerators([lifecycleConditionId, 1n]), 0n);

    // Act: approve and split exactly one MOCK into one YES and one NO.
    await collateral.write.approve([adapter.address, oneToken], {
      account: user.account,
    });
    await adapter.write.splitBinary(
      [oracle.account.address, lifecycleQuestionId, oneToken],
      { account: user.account },
    );

    // Assert: one MOCK was escrowed and the user received both positions.
    assert.equal(
      await collateral.read.balanceOf([user.account.address]),
      initialBalance - oneToken,
    );
    assert.equal(await ctf.read.balanceOf([user.account.address, yesId]), oneToken);
    assert.equal(await ctf.read.balanceOf([user.account.address, noId]), oneToken);

    // Only the condition's oracle resolves it with YES winning.
    await ctf.write.reportPayouts([lifecycleQuestionId, [1n, 0n]], {
      account: oracle.account,
    });
    assert.equal(await ctf.read.payoutDenominator([lifecycleConditionId]), 1n);
    assert.equal(await ctf.read.payoutNumerators([lifecycleConditionId, 0n]), 1n);
    assert.equal(await ctf.read.payoutNumerators([lifecycleConditionId, 1n]), 0n);

    // The adapter pulls ERC-1155 positions, so explicitly authorize it.
    await ctf.write.setApprovalForAll([adapter.address, true], {
      account: user.account,
    });
    await adapter.write.redeemBinary(
      [oracle.account.address, lifecycleQuestionId],
      { account: user.account },
    );

    // The winning YES pays exactly one MOCK; the losing NO pays zero.
    assert.equal(await ctf.read.balanceOf([user.account.address, yesId]), 0n);
    assert.equal(await ctf.read.balanceOf([user.account.address, noId]), 0n);
    assert.equal(await collateral.read.balanceOf([user.account.address]), initialBalance);
    assert.equal(await collateral.read.balanceOf([adapter.address]), 0n);
    assert.equal(await ctf.read.payoutDenominator([lifecycleConditionId]), 1n);
    assert.equal(await ctf.read.payoutNumerators([lifecycleConditionId, 0n]), 1n);
    assert.equal(await ctf.read.payoutNumerators([lifecycleConditionId, 1n]), 0n);

    // A second redemption has the adapter's documented no-positions error.
    await viem.assertions.revertWithCustomError(
      adapter.write.redeemBinary(
        [oracle.account.address, lifecycleQuestionId],
        { account: user.account },
      ),
      adapter,
      "NoPositionsToRedeem",
    );
  });

  it("rejects splitting when the adapter allowance is insufficient", async function () {
    await collateral.write.approve([adapter.address, oneToken - 1n], {
      account: user.account,
    });

    await assert.rejects(
      adapter.write.splitBinary(
        [oracle.account.address, questionId, oneToken],
        { account: user.account },
      ),
    );

    assert.equal(
      await collateral.read.balanceOf([user.account.address]),
      userStartingCollateral,
    );
    assert.equal(await ctf.read.balanceOf([user.account.address, yesPositionId]), 0n);
    assert.equal(await ctf.read.balanceOf([user.account.address, noPositionId]), 0n);
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
    await viem.assertions.revertWith(
      ctf.write.reportPayouts([questionId, [1n, 0n]], {
        account: user.account,
      }),
      "condition not prepared or found",
    );

    assert.equal(await ctf.read.payoutDenominator([conditionId]), 0n);

    await ctf.write.reportPayouts([questionId, [1n, 0n]], {
      account: oracle.account,
    });
    assert.equal(await ctf.read.payoutDenominator([conditionId]), 1n);
  });

  it("prevents even the authorized oracle from overwriting a resolved payout", async function () {
    await ctf.write.reportPayouts([questionId, [1n, 0n]], { account: oracle.account });
    await viem.assertions.revertWith(
      ctf.write.reportPayouts([questionId, [0n, 1n]], { account: oracle.account }),
      "payout denominator already set",
    );
    assert.equal(await ctf.read.payoutDenominator([conditionId]), 1n);
    assert.equal(await ctf.read.payoutNumerators([conditionId, 0n]), 1n);
    assert.equal(await ctf.read.payoutNumerators([conditionId, 1n]), 0n);
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
