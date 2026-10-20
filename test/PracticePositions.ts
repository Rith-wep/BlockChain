import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { network } from "hardhat";

describe("PracticePositions", async function () {
  const { viem } = await network.create();
  const [deployer, receiver] = await viem.getWalletClients();

  let positions: Awaited<ReturnType<typeof viem.deployContract>>;

  // start every test with fresh yes and no balances.
  beforeEach(async function () {
    positions = await viem.deployContract("PracticePositions");
  });

  // make sure yes and no are different ids with their own balances.
  it("creates separate yes and no token ids", async function () {
    const yesId = await positions.read.YES();
    const noId = await positions.read.NO();

    assert.equal(yesId, 0n);
    assert.equal(noId, 1n);
    assert.notEqual(yesId, noId);
    assert.equal(
      await positions.read.balanceOf([deployer.account.address, yesId]),
      100n,
    );
    assert.equal(
      await positions.read.balanceOf([deployer.account.address, noId]),
      100n,
    );
  });

  // make sure each token id can be transferred independently.
  it("transfers yes and no balances independently", async function () {
    const yesId = await positions.read.YES();
    const noId = await positions.read.NO();

    await positions.write.safeTransferFrom([
      deployer.account.address,
      receiver.account.address,
      yesId,
      10n,
      "0x",
    ]);
    await positions.write.safeTransferFrom([
      deployer.account.address,
      receiver.account.address,
      noId,
      25n,
      "0x",
    ]);

    assert.equal(
      await positions.read.balanceOf([receiver.account.address, yesId]),
      10n,
    );
    assert.equal(
      await positions.read.balanceOf([receiver.account.address, noId]),
      25n,
    );
    assert.equal(
      await positions.read.balanceOf([deployer.account.address, yesId]),
      90n,
    );
    assert.equal(
      await positions.read.balanceOf([deployer.account.address, noId]),
      75n,
    );
  });
});
