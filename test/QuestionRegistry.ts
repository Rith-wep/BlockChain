import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { network } from "hardhat";

// keep all question registry tests together.
describe("QuestionRegistry", async function () {
  const { viem } = await network.create();
  const [creator, otherAccount] = await viem.getWalletClients();

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
    assert.equal(question.resolved, false);
    assert.equal(question.outcome, false);
  });

  // make sure the creator can resolve their question.
  it("lets the creator resolve a question", async function () {
    await registry.write.createQuestion(["Will it resolve?"]);

    await viem.assertions.emitWithArgs(
      registry.write.resolveQuestion([0n, true]),
      registry,
      "QuestionResolved",
      [0n, true],
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

  // do not let someone else resolve the question.
  it("rejects resolution by an account that is not the creator", async function () {
    await registry.write.createQuestion(["Creator-only resolution?"]);

    await viem.assertions.revertWithCustomError(
      registry.write.resolveQuestion([0n, true], { account: otherAccount.account }),
      registry,
      "NotCreator",
    );
  });

  // do not allow the outcome to be changed later.
  it("rejects resolving the same question twice", async function () {
    await registry.write.createQuestion(["Resolve once?"]);
    await registry.write.resolveQuestion([0n, true]);

    await viem.assertions.revertWithCustomError(
      registry.write.resolveQuestion([0n, false]),
      registry,
      "AlreadyResolved",
    );
  });
});
