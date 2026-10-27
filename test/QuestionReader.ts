import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { network } from "hardhat";

// keep all question reader tests together.
describe("QuestionReader", async function () {
  const { viem } = await network.create();
  const [creator] = await viem.getWalletClients();
  const readerErrors = [
    { type: "error", name: "ZeroRegistryAddress", inputs: [] },
    { type: "error", name: "RegistryAddressHasNoCode", inputs: [{ name: "registryAddress", type: "address" }] },
  ] as const;

  let registry: Awaited<ReturnType<typeof viem.deployContract>>;
  let reader: Awaited<ReturnType<typeof viem.deployContract>>;

  // deploy the registry first, then give its address to the reader.
  beforeEach(async function () {
    registry = await viem.deployContract("QuestionRegistry");
    reader = await viem.deployContract("QuestionReader", [registry.address]);
  });

  // make sure the reader returns data from the existing registry.
  it("reads an existing question", async function () {
    await registry.write.createQuestion(["Will the reader find this question?"]);
    await registry.write.assignResolver([0n, creator.account.address]);
    await registry.write.resolveQuestion([0n, true], { account: creator.account });

    const question = await reader.read.readQuestion([0n]);

    assert.equal(question.text, "Will the reader find this question?");
    assert.equal(question.creator.toLowerCase(), creator.account.address.toLowerCase());
    assert.equal(question.resolved, true);
    assert.equal(question.outcome, true);
  });

  // make sure an id outside the registry is rejected with a clear error.
  it("rejects an invalid question id", async function () {
    await registry.write.createQuestion(["The only question"]);

    await viem.assertions.revertWithCustomErrorWithArgs(
      reader.read.readQuestion([1n]),
      reader,
      "InvalidQuestionId",
      [1n, 1n],
    );
  });

  it("rejects a zero registry address", async function () {
    await viem.assertions.revertWithCustomError(
      viem.deployContract("QuestionReader", ["0x0000000000000000000000000000000000000000"]),
      { abi: readerErrors },
      "ZeroRegistryAddress",
    );
  });

  it("rejects a registry address with no contract code", async function () {
    await viem.assertions.revertWithCustomErrorWithArgs(
      viem.deployContract("QuestionReader", [creator.account.address]),
      { abi: readerErrors },
      "RegistryAddressHasNoCode",
      [creator.account.address],
    );
  });
});
