import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { network } from "hardhat";

// keep all question registry tests together.
describe("QuestionRegistry", async function () {
  const { viem } = await network.create();
  const [creator, otherAccount, resolver] = await viem.getWalletClients();

  let registry: Awaited<ReturnType<typeof viem.deployContract>>;

  // start every test with a fresh contract.
  beforeEach(async function () {
    registry = await viem.deployContract("QuestionRegistry");
  });

  // make sure a new question is saved correctly.
  it("creates a question and stores its initial state", async function () {
    await viem.assertions.emitWithArgs(
      registry.write.createQuestion(["Will the local test pass?"]),
      registry,
      "QuestionCreated",
      [0n, creator.account.address, "Will the local test pass?"],
    );

    assert.equal(await registry.read.questionCount(), 1n);

    const question = await registry.read.getQuestion([0n]);
    assert.equal(question.text, "Will the local test pass?");
    assert.equal(question.creator.toLowerCase(), creator.account.address.toLowerCase());
    assert.equal(question.resolver, "0x0000000000000000000000000000000000000000");
    assert.equal(question.resolved, false);
    assert.equal(question.outcome, false);
  });

  // the owner selects a resolver; only that resolver can publish the outcome.
  it("lets the assigned resolver resolve a question", async function () {
    await registry.write.createQuestion(["Will it resolve?"]);
    await registry.write.assignResolver([0n, resolver.account.address]);

    await viem.assertions.emitWithArgs(
      registry.write.resolveQuestion([0n, true], { account: resolver.account }),
      registry,
      "QuestionResolved",
      [0n, resolver.account.address, true],
    );

    const question = await registry.read.getQuestion([0n]);
    assert.equal(question.resolved, true);
    assert.equal(question.outcome, true);
  });

  // do not allow a question with no text.
  it("rejects an empty question", async function () {
    await viem.assertions.revertWithCustomError(
      registry.write.createQuestion([""]),
      registry,
      "EmptyQuestion",
    );
  });

  it("requires an assigned resolver before resolution", async function () {
    await registry.write.createQuestion(["A resolver must be selected first"]);
    await viem.assertions.revertWithCustomError(
      registry.write.resolveQuestion([0n, true]), registry, "ResolverNotAssigned",
    );
  });

  it("rejects resolution by an account that is not the assigned resolver", async function () {
    await registry.write.createQuestion(["Only the assigned resolver can decide"]);
    await registry.write.assignResolver([0n, resolver.account.address]);
    await viem.assertions.revertWithCustomError(
      registry.write.resolveQuestion([0n, true], { account: otherAccount.account }),
      registry,
      "NotResolver",
    );
  });

  it("allows only the owner to assign or replace an unresolved question resolver", async function () {
    await registry.write.createQuestion(["Resolver is owner-managed"]);
    await viem.assertions.revertWithCustomError(
      registry.write.assignResolver([0n, resolver.account.address], { account: otherAccount.account }),
      registry,
      "OwnableUnauthorizedAccount",
    );
    await viem.assertions.revertWithCustomError(
      registry.write.assignResolver([0n, "0x0000000000000000000000000000000000000000"]),
      registry,
      "InvalidResolver",
    );
    await registry.write.assignResolver([0n, resolver.account.address]);
    await viem.assertions.emitWithArgs(
      registry.write.assignResolver([0n, otherAccount.account.address]),
      registry,
      "ResolverAssigned",
      [0n, resolver.account.address, otherAccount.account.address, creator.account.address],
    );
    assert.equal((await registry.read.getQuestion([0n])).resolver.toLowerCase(), otherAccount.account.address.toLowerCase());
  });

  it("revokes the old resolver and gives the owner no direct resolution bypass", async function () {
    await registry.write.createQuestion(["Only the current resolver can decide"]);
    await registry.write.assignResolver([0n, resolver.account.address]);
    await registry.write.assignResolver([0n, otherAccount.account.address]);
    for (const account of [resolver.account, creator.account]) {
      await viem.assertions.revertWithCustomError(
        registry.write.resolveQuestion([0n, true], { account }), registry, "NotResolver",
      );
    }
    assert.equal((await registry.read.getQuestion([0n])).resolved, false);
    await registry.write.resolveQuestion([0n, false], { account: otherAccount.account });
    assert.equal((await registry.read.getQuestion([0n])).resolved, true);
  });

  it("does not allow resolver reassignment after resolution", async function () {
    await registry.write.createQuestion(["Resolved questions keep their resolver history"]);
    await registry.write.assignResolver([0n, resolver.account.address]);
    await registry.write.resolveQuestion([0n, false], { account: resolver.account });
    await viem.assertions.revertWithCustomError(
      registry.write.assignResolver([0n, otherAccount.account.address]), registry, "AlreadyResolved",
    );
  });

  // do not allow the outcome to be changed later.
  it("rejects resolving the same question twice", async function () {
    await registry.write.createQuestion(["Resolve once?"]);
    await registry.write.assignResolver([0n, creator.account.address]);
    await registry.write.resolveQuestion([0n, true], { account: creator.account });

    await viem.assertions.revertWithCustomError(
      registry.write.resolveQuestion([0n, false]),
      registry,
      "AlreadyResolved",
    );
  });
});
