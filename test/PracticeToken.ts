import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { network } from "hardhat";

describe("PracticeToken", async function () {
  const { viem } = await network.create();
  const [deployer, receiver] = await viem.getWalletClients();
  const initialSupply = 1_000_000n * 10n ** 18n;

  let token: Awaited<ReturnType<typeof viem.deployContract>>;

  // start every test with a new fixed-supply token.
  beforeEach(async function () {
    token = await viem.deployContract("PracticeToken");
  });

  // make sure every token starts in the deployer's balance.
  it("gives the fixed initial supply to the deployer", async function () {
    assert.equal(await token.read.name(), "Practice Token");
    assert.equal(await token.read.symbol(), "PTK");
    assert.equal(await token.read.totalSupply(), initialSupply);
    assert.equal(await token.read.balanceOf([deployer.account.address]), initialSupply);
    assert.equal(await token.read.balanceOf([receiver.account.address]), 0n);
  });

  // make sure fungible units can move between accounts.
  it("transfers tokens to another account", async function () {
    const amount = 250n * 10n ** 18n;

    await token.write.transfer([receiver.account.address, amount]);

    assert.equal(await token.read.balanceOf([receiver.account.address]), amount);
    assert.equal(
      await token.read.balanceOf([deployer.account.address]),
      initialSupply - amount,
    );
    assert.equal(await token.read.totalSupply(), initialSupply);
  });
});
