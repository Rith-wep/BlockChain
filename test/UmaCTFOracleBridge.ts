import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { network } from "hardhat";
import { encodeFunctionData, hexToString, toFunctionSelector, zeroAddress, zeroHash } from "viem";

// all deployments below use a fresh local network, never Sepolia.
describe("UMA CTF oracle bridge (mock UMA, official CTF)", async () => {
  const { viem, networkHelpers } = await network.create();
  const [owner, proposer, challenger, stranger] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const marketId = `0x${"a1".repeat(32)}` as const;
  const otherId = `0x${"b2".repeat(32)}` as const;
  const floor = 400_000_000n;
  let ctf: Awaited<ReturnType<typeof viem.deployContract<"ConditionalTokens">>>;
  let token: Awaited<ReturnType<typeof viem.deployContract<"TestUmaBondToken">>>;
  let oo: Awaited<ReturnType<typeof viem.deployContract<"TestUmaOracle">>>;
  let bridge: Awaited<ReturnType<typeof viem.deployContract<"UmaCTFOracleBridge">>>;
  let deadline: bigint;
  let questionId: `0x${string}`;

  beforeEach(async () => {
    ctf = await viem.deployContract("ConditionalTokens");
    token = await viem.deployContract("TestUmaBondToken");
    oo = await viem.deployContract("TestUmaOracle");
    await oo.write.configure([token.address, true, true, floor]);
    bridge = await viem.deployContract("UmaCTFOracleBridge", [ctf.address, oo.address, token.address, owner.account.address]);
    deadline = (await publicClient.getBlock()).timestamp + 100n;
    questionId = await bridge.read.getQuestionId([marketId]);
    for (const wallet of [proposer, challenger]) {
      await token.write.transfer([wallet.account.address, floor * 4n]);
      await token.write.approve([bridge.address, floor * 4n], { account: wallet.account });
      await token.write.approve([oo.address, floor * 4n], { account: wallet.account });
    }
  });

  async function create(id = marketId) {
    await bridge.write.createMarket([id, "YES iff the published test result is PASS at the deadline; otherwise NO.", "Test publisher record v1", "INVALID iff the record is withdrawn or contradictory at the deadline.", deadline]);
    return bridge.read.getQuestionId([id]);
  }
  async function propose(outcome = 0, id = questionId, cap = floor) {
    await bridge.write.assertOutcome([id, outcome, cap], { account: proposer.account });
    return (await bridge.read.getMarket([id])).activeAssertion;
  }
  async function ready(outcome = 0) {
    await create();
    await networkHelpers.time.increaseTo(Number(deadline));
    return propose(outcome);
  }
  async function settle(id: `0x${string}`) {
    await networkHelpers.time.increase(7201);
    await oo.write.settleAssertion([id]);
  }
  type BridgeError = Extract<(typeof bridge.abi)[number], { type: "error" }>["name"];
  async function error(action: Promise<unknown>, name: BridgeError) {
    await viem.assertions.revertWithCustomError(action, bridge, name);
  }

  it("uses the unchanged official interfaces from the pinned UMA revision", async () => {
    for (const [file, hash] of [
      ["OptimisticOracleV3Interface.sol", "3a32922de084694b0e7fa29cf4a8f026eb9e6fb594fe3c54a52023f409604441"],
      ["OptimisticOracleV3CallbackRecipientInterface.sol", "e5f01fed607c621a7a9ed52c98205aa8821d710a637a071a9df0d65fe599c8e1"],
    ]) {
      const source = await readFile(new URL(`../contracts/uma-oracle/vendor/${file}`, import.meta.url), "utf8");
      assert.equal(createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex"), hash);
    }
  });

  it("rejects zero/no-code dependencies, wrong decimals, and unsupported currencies/identifiers", async () => {
    for (const index of [0, 1, 2]) {
      for (const invalid of [zeroAddress, stranger.account.address]) {
        const args = [ctf.address, oo.address, token.address, owner.account.address] as const;
        const changed = [...args] as [typeof ctf.address, typeof oo.address, typeof token.address, typeof owner.account.address];
        changed[index] = invalid;
        await error(viem.deployContract("UmaCTFOracleBridge", changed), "InvalidConfiguration");
      }
    }
    const mock = await viem.deployContract("MockCollateral");
    await error(viem.deployContract("UmaCTFOracleBridge", [ctf.address, oo.address, mock.address, owner.account.address]), "InvalidConfiguration");
    for (const flags of [[false, true], [true, false]] as const) {
      await oo.write.configure([token.address, ...flags, floor]);
      await error(viem.deployContract("UmaCTFOracleBridge", [ctf.address, oo.address, token.address, owner.account.address]), "UnsupportedProviderParameters");
    }
    await error(viem.deployContract("UmaCTFOracleBridge", [ctf.address, oo.address, token.address, zeroAddress]), "OwnableInvalidOwner");
  });

  it("requires owner, future deadline, unique id, and complete bounded rules", async () => {
    await error(bridge.write.createMarket([marketId, "r", "e", "i", deadline], { account: stranger.account }), "OwnableUnauthorizedAccount");
    await error(bridge.write.createMarket([zeroHash, "r", "e", "i", deadline]), "InvalidMarket");
    await error(bridge.write.createMarket([marketId, "r", "e", "i", 1n]), "InvalidMarket");
    for (const inputs of [["", "e", "i"], ["r", "", "i"], ["r", "e", ""], ["r".repeat(2049), "e", "i"]]) {
      await error(bridge.write.createMarket([marketId, inputs[0], inputs[1], inputs[2], deadline]), "InvalidMarket");
    }
    await create();
    await error(bridge.write.createMarket([marketId, "different", "e", "i", deadline]), "InvalidMarket");
  });

  it("prepares the official bridge-oracle condition and reuses an externally prepared exact tuple", async () => {
    await ctf.write.prepareCondition([bridge.address, questionId, 2n], { account: stranger.account });
    await create();
    const m = await bridge.read.getMarket([questionId]);
    assert.equal(m.conditionId, await ctf.read.getConditionId([bridge.address, questionId, 2n]));
    assert.equal(await ctf.read.getOutcomeSlotCount([m.conditionId]), 2n);
    assert.equal(await ctf.read.payoutDenominator([m.conditionId]), 0n);
    assert.equal(m.deadline, deadline);
    assert.match(m.invalidCriteria, /withdrawn/);
    assert.notEqual(await bridge.read.getQuestionId([otherId]), questionId);
    const second = await viem.deployContract("UmaCTFOracleBridge", [ctf.address, oo.address, token.address, owner.account.address]);
    assert.notEqual(await second.read.getQuestionId([marketId]), questionId);
  });

  it("blocks unknown markets, early assertions, invalid outcome enum, and pending duplicates", async () => {
    await error(bridge.write.assertOutcome([questionId, 0, floor]), "MarketNotOpen");
    await create();
    await error(bridge.write.assertOutcome([questionId, 0, floor]), "MarketNotOpen");
    await networkHelpers.time.increaseTo(Number(deadline));
    await assert.rejects(bridge.write.assertOutcome([questionId, 3, floor]));
    await propose();
    await error(bridge.write.assertOutcome([questionId, 1, floor], { account: challenger.account }), "MarketNotOpen");
  });

  it("pulls the exact bond, binds provider fields, clears approval, and refunds proposer directly", async () => {
    const before = await token.read.balanceOf([proposer.account.address]);
    const id = await ready();
    const a = await oo.read.getAssertion([id]);
    assert.equal(a.asserter.toLowerCase(), proposer.account.address.toLowerCase());
    assert.equal(a.callbackRecipient.toLowerCase(), bridge.address.toLowerCase());
    assert.equal(a.escalationManagerSettings.escalationManager, zeroAddress);
    assert.equal(a.expirationTime - a.assertionTime, 7200n);
    assert.equal(a.bond, floor);
    assert.equal(await token.read.balanceOf([proposer.account.address]), before - floor);
    assert.equal(await token.read.balanceOf([bridge.address]), 0n);
    assert.equal(await token.read.allowance([bridge.address, oo.address]), 0n);
    const claim = hexToString(await oo.read.lastClaim());
    for (const part of [questionId, "YES", "Test publisher record v1", "INVALID criteria", bridge.address.toLowerCase()]) assert.ok(claim.includes(part));
    await settle(id);
    assert.equal(await token.read.balanceOf([proposer.account.address]), before);
    assert.equal(await token.read.balanceOf([bridge.address]), 0n);
  });

  it("rejects fee-on-transfer bonds atomically", async () => {
    await create(); await networkHelpers.time.increaseTo(Number(deadline));
    const before = await token.read.balanceOf([proposer.account.address]);
    await token.write.setTransferFee([1n]);
    await error(bridge.write.assertOutcome([questionId, 0, floor], { account: proposer.account }), "IncorrectBondTransfer");
    assert.equal(await token.read.balanceOf([proposer.account.address]), before);
    assert.equal(await token.read.balanceOf([bridge.address]), 0n);
    assert.equal((await bridge.read.getMarket([questionId])).activeAssertion, zeroHash);
  });

  it("does not spend or refund unrelated tokens donated to the bridge", async () => {
    await token.write.transfer([bridge.address, 7n]);
    const id = await ready(); await settle(id);
    assert.equal(await token.read.balanceOf([bridge.address]), 7n);
  });

  it("refreshes provider minimum, enforces spend cap, and never drops below the floor", async () => {
    await create();
    await networkHelpers.time.increaseTo(Number(deadline));
    await oo.write.setNextMinimum([floor * 2n]);
    await error(bridge.write.assertOutcome([questionId, 0, floor], { account: proposer.account }), "BondLimitExceeded");
    assert.equal(await token.read.balanceOf([bridge.address]), 0n);
    const id = await propose(0, questionId, floor * 2n);
    assert.equal((await oo.read.getAssertion([id])).bond, floor * 2n);
    await oo.write.configure([token.address, true, true, 0n]);
    assert.equal(await bridge.read.requiredBond(), floor);
  });

  it("rechecks currency and identifier eligibility and insufficient bond funding", async () => {
    await create(); await networkHelpers.time.increaseTo(Number(deadline));
    for (const flags of [[false, true], [true, false]] as const) {
      await oo.write.configure([token.address, ...flags, floor]);
      await error(bridge.write.assertOutcome([questionId, 0, floor], { account: proposer.account }), "UnsupportedProviderParameters");
    }
    await oo.write.configure([token.address, true, true, floor]);
    await assert.rejects(bridge.write.assertOutcome([questionId, 0, floor], { account: stranger.account }));
    await token.write.approve([bridge.address, 0n], { account: proposer.account });
    await assert.rejects(propose());
    assert.equal((await bridge.read.getMarket([questionId])).activeAssertion, zeroHash);
  });

  it("rejects unauthorized and unknown callback ids", async () => {
    await error(bridge.write.assertionResolvedCallback([zeroHash, true]), "UnauthorizedCallback");
    await error(bridge.write.assertionDisputedCallback([zeroHash]), "UnauthorizedCallback");
    await error(oo.write.notifyResolved([bridge.address, zeroHash, true]), "InvalidAssertion");
    await error(oo.write.notifyDisputed([bridge.address, zeroHash]), "InvalidAssertion");
  });

  for (const [outcome, vector] of [[0, [1n, 0n]], [1, [0n, 1n]], [2, [1n, 1n]]] as const) {
    it(`finalizes accepted ${["YES", "NO", "INVALID"][outcome]} once with the exact payout`, async () => {
      const id = await ready(outcome);
      await error(bridge.write.finalizeMarket([questionId]), "NotFinal");
      await settle(id);
      const m = await bridge.read.getMarket([questionId]);
      assert.equal(await ctf.read.payoutDenominator([m.conditionId]), 0n); // callback is not finalization
      await bridge.write.finalizeMarket([questionId], { account: stranger.account });
      assert.equal(await ctf.read.payoutNumerators([m.conditionId, 0n]), vector[0]);
      assert.equal(await ctf.read.payoutNumerators([m.conditionId, 1n]), vector[1]);
      await error(bridge.write.finalizeMarket([questionId]), "NotFinal");
      await error(bridge.write.assertOutcome([questionId, 0, floor]), "MarketNotOpen");
      await oo.write.notifyResolved([bridge.address, id, true]);
      await oo.write.notifyDisputed([bridge.address, id]); // terminal notification cannot undo state
      assert.equal((await bridge.read.getMarket([questionId])).finalized, true);
      await error(oo.write.notifyResolved([bridge.address, id, false]), "ConflictingCallback");
    });
  }

  it("blocks disputed unresolved assertions even after timeout, then accepts an arbitrated result", async () => {
    const id = await ready(1);
    await oo.write.disputeAssertion([id, challenger.account.address], { account: challenger.account });
    await oo.write.notifyDisputed([bridge.address, id]);
    await networkHelpers.time.increase(100_000);
    await assert.rejects(oo.write.settleAssertion([id]));
    await error(bridge.write.finalizeMarket([questionId]), "NotFinal");
    await error(bridge.write.assertOutcome([questionId, 2, floor]), "MarketNotOpen");
    assert.equal((await bridge.read.proposals([id]))[5], 2);
    await oo.write.setArbitration([id, true]);
    await oo.write.settleAssertion([id]);
    await bridge.write.finalizeMarket([questionId]);
    assert.equal(await ctf.read.payoutNumerators([(await bridge.read.getMarket([questionId])).conditionId, 1n]), 1n);
  });

  it("rejected claims reopen without payouts; stale notifications cannot contaminate a new attempt", async () => {
    const id = await ready(0);
    const challengerBefore = await token.read.balanceOf([challenger.account.address]);
    await oo.write.disputeAssertion([id, challenger.account.address], { account: challenger.account });
    await oo.write.setArbitration([id, false]);
    await oo.write.settleAssertion([id]);
    assert.equal(await token.read.balanceOf([challenger.account.address]), challengerBefore + floor / 2n);
    assert.equal((await bridge.read.getMarket([questionId])).activeAssertion, zeroHash);
    await error(bridge.write.finalizeMarket([questionId]), "NotFinal");
    const next = await propose(2);
    assert.notEqual(id, next);
    await oo.write.notifyResolved([bridge.address, id, false]);
    await oo.write.notifyDisputed([bridge.address, id]);
    await error(oo.write.notifyResolved([bridge.address, id, true]), "ConflictingCallback");
    assert.equal((await bridge.read.getMarket([questionId])).activeAssertion, next);
    assert.equal(await ctf.read.payoutDenominator([(await bridge.read.getMarket([questionId])).conditionId]), 0n);
    await settle(next); await bridge.write.finalizeMarket([questionId]);
  });

  it("does not trust a callback without independent settled provider state", async () => {
    const id = await ready();
    await oo.write.notifyResolved([bridge.address, id, true]);
    await error(bridge.write.finalizeMarket([questionId]), "NotFinal");
    await settle(id); // matching repeated notification must not break real settlement
    await bridge.write.finalizeMarket([questionId]);
  });

  it("prevents a fake rejection from opening a new funded attempt", async () => {
    const id = await ready();
    await oo.write.notifyResolved([bridge.address, id, false]);
    await error(bridge.write.assertOutcome([questionId, 1, floor], { account: proposer.account }), "NotFinal");
  });

  it("keeps outcomes isolated across markets and rejects corrupted provider identity", async () => {
    await create(); const other = await create(otherId);
    await networkHelpers.time.increaseTo(Number(deadline));
    const first = await propose(0); const second = await propose(1, other);
    await settle(first);
    await bridge.write.finalizeMarket([questionId]);
    await error(bridge.write.finalizeMarket([other]), "NotFinal");
    await oo.write.corruptRecipient([second, stranger.account.address]);
    await oo.write.notifyResolved([bridge.address, second, true]);
    await error(bridge.write.finalizeMarket([other]), "InvalidAssertion");
  });

  it("rolls back funding on early callbacks, malformed provider records, and reused assertion ids", async () => {
    await create(); const other = await create(otherId);
    await networkHelpers.time.increaseTo(Number(deadline));
    const before = await token.read.balanceOf([proposer.account.address]);
    for (const [early, wrong] of [[true, false], [false, true]]) {
      await oo.write.setFaults([zeroHash, early, wrong]);
      await error(bridge.write.assertOutcome([questionId, 0, floor], { account: proposer.account }), "InvalidAssertion");
      assert.equal(await token.read.balanceOf([proposer.account.address]), before);
      assert.equal(await token.read.allowance([bridge.address, oo.address]), 0n);
    }
    await oo.write.setFaults([zeroHash, false, false]);
    const id = await propose();
    await oo.write.setFaults([id, false, false]);
    await error(bridge.write.assertOutcome([other, 1, floor], { account: proposer.account }), "InvalidAssertion");
    assert.equal((await bridge.read.getMarket([other])).activeAssertion, zeroHash);
  });

  it("blocks bond-token reentry without breaking the outer funded assertion", async () => {
    await create(); await networkHelpers.time.increaseTo(Number(deadline));
    await token.write.setHook([bridge.address, encodeFunctionData({ abi: bridge.abi, functionName: "assertOutcome", args: [questionId, 1, floor] })]);
    const id = await propose();
    assert.equal(await token.read.hookSucceeded(), false);
    assert.equal(await token.read.hookResult(), toFunctionSelector("ReentrancyGuardReentrantCall()"));
    assert.equal((await bridge.read.getMarket([questionId])).activeAssertion, id);
  });

  it("retries CTF reporting failures and rejects incorrect condition state", async () => {
    const retry = await viem.deployContract("TestRetryCTF");
    bridge = await viem.deployContract("UmaCTFOracleBridge", [retry.address, oo.address, token.address, owner.account.address]);
    await token.write.approve([bridge.address, floor], { account: proposer.account });
    questionId = await bridge.read.getQuestionId([marketId]);
    const id = await ready(); await settle(id);
    const m = await bridge.read.getMarket([questionId]);
    await retry.write.corruptSlots([m.conditionId, 3n]);
    await error(bridge.write.finalizeMarket([questionId]), "InvalidCondition");
    await retry.write.corruptSlots([m.conditionId, 2n]);
    await retry.write.setFailure([true]);
    await assert.rejects(bridge.write.finalizeMarket([questionId]));
    assert.equal((await bridge.read.getMarket([questionId])).finalized, false);
    await retry.write.setFailure([false]);
    await bridge.write.finalizeMarket([questionId]);
    assert.equal((await bridge.read.getMarket([questionId])).finalized, true);
  });

  it("models callback failure rolling back dispute/settlement and allowing retry", async () => {
    const recipient = await viem.deployContract("TestRevertingUmaRecipient");
    const id = await ready();
    await oo.write.corruptRecipient([id, recipient.address]);
    const before = await token.read.balanceOf([challenger.account.address]);
    await assert.rejects(oo.write.disputeAssertion([id, challenger.account.address], { account: challenger.account }));
    assert.equal(await token.read.balanceOf([challenger.account.address]), before);
    assert.equal((await oo.read.getAssertion([id])).disputer, zeroAddress);
    await networkHelpers.time.increase(7201);
    const proposerBefore = await token.read.balanceOf([proposer.account.address]);
    await assert.rejects(oo.write.settleAssertion([id]));
    assert.equal((await oo.read.getAssertion([id])).settled, false);
    assert.equal(await token.read.balanceOf([proposer.account.address]), proposerBefore);
    await oo.write.corruptRecipient([id, bridge.address]);
    await oo.write.settleAssertion([id]);
    await bridge.write.finalizeMarket([questionId]);
  });

  for (const outcome of [0, 1, 2]) {
    it(`completes actual CTF split and separate holder redemption for outcome ${outcome}`, async () => {
      await create();
      const collateral = await viem.deployContract("MockCollateral");
      const adapter = await viem.deployContract("LocalCTFAdapter", [ctf.address, collateral.address]);
      const amount = 10n ** 18n;
      await collateral.write.transfer([proposer.account.address, amount]);
      await collateral.write.approve([adapter.address, amount], { account: proposer.account });
      await adapter.write.splitBinary([bridge.address, questionId, amount], { account: proposer.account });
      const ids = await adapter.read.getBinaryPositionIds([bridge.address, questionId]);
      await ctf.write.safeTransferFrom([proposer.account.address, challenger.account.address, ids[4], amount, "0x"], { account: proposer.account });
      await ctf.write.setApprovalForAll([adapter.address, true], { account: proposer.account });
      await ctf.write.setApprovalForAll([adapter.address, true], { account: challenger.account });
      await networkHelpers.time.increaseTo(Number(deadline));
      const id = await propose(outcome); await settle(id); await bridge.write.finalizeMarket([questionId]);
      await adapter.write.redeemBinary([bridge.address, questionId], { account: proposer.account });
      await adapter.write.redeemBinary([bridge.address, questionId], { account: challenger.account });
      assert.equal(await collateral.read.balanceOf([proposer.account.address]), outcome === 0 ? amount : outcome === 1 ? 0n : amount / 2n);
      assert.equal(await collateral.read.balanceOf([challenger.account.address]), outcome === 1 ? amount : outcome === 0 ? 0n : amount / 2n);
      assert.equal(await ctf.read.balanceOf([proposer.account.address, ids[3]]), 0n);
      assert.equal(await ctf.read.balanceOf([challenger.account.address, ids[4]]), 0n);
      assert.equal(await collateral.read.balanceOf([bridge.address]), 0n);
      await viem.assertions.revertWithCustomError(adapter.write.redeemBinary([bridge.address, questionId], { account: proposer.account }), adapter, "NoPositionsToRedeem");
    });
  }
});
