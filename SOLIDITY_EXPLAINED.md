# understanding question registry

This lesson explains the code in `contracts/QuestionRegistry.sol` and
`test/QuestionRegistry.ts`. The contract is a learning example. It is not yet a
complete prediction market.

## 1. what is a smart contract?

A smart contract is a program that runs on a blockchain. Its code and saved
data are shared by the blockchain network. After a contract is deployed, users
can call its functions by sending transactions.

Your smart contract begins here:

```solidity
contract QuestionRegistry {
```

`contract` is similar to a class in another programming language. It groups the
contract's data, functions, errors, and events. `QuestionRegistry` is the name
of this contract.

Your contract stores questions, remembers who created them, and lets their
creator save a true-or-false outcome.

The first line is:

```solidity
// SPDX-License-Identifier: MIT
```

This tells tools and other developers that the source code uses the MIT
software licence. It does not change how the contract runs.

## 2. what does `pragma solidity ^0.8.34` mean?

```solidity
pragma solidity ^0.8.34;
```

This tells the Solidity compiler which compiler versions may compile the file.

- `0.8.34` is the minimum version allowed.
- `^` allows compatible versions after `0.8.34`.
- it does not allow Solidity `0.9.0` or newer because that could contain
  breaking changes.

Your Hardhat configuration currently selects exactly Solidity `0.8.34`, so that
is the version used when you run `npm.cmd run compile`.

## 3. what is a struct?

A `struct` is a custom data type that groups related values under one name.

Your contract defines this struct:

```solidity
struct Question {
    string text;
    address creator;
    bool resolved;
    bool outcome;
}
```

Each `Question` contains four pieces of information:

- `text` is the written question.
- `creator` is the blockchain address that created it.
- `resolved` says whether the question has received a final answer.
- `outcome` stores that answer as `true` or `false`.

Using a struct keeps these values together. Without it, the contract would need
separate collections for question text, creators, resolution state, and
outcomes. Those collections would be harder to keep in sync.

The questions are stored in this array:

```solidity
Question[] private questions;
```

`Question[]` means a list of `Question` structs. The list can grow when new
questions are added. `private` means other contracts cannot directly access
this variable. Users read it through `getQuestion` and `questionCount`.

Array positions start at zero. The first question has id `0`, the second has id
`1`, and so on.

## 4. storage, memory, and calldata

These words tell Solidity where data should live.

### storage

`storage` is permanent contract data saved on the blockchain.

```solidity
Question storage question = questions[questionId];
```

Here, `question` points to the real item inside the `questions` array. It is not
a separate copy. Therefore, these lines update the permanent question:

```solidity
question.resolved = true;
question.outcome = outcome;
```

Writing to storage changes blockchain state and costs gas on a real network.

### memory

`memory` is temporary data used only while a function is running.

```solidity
function getQuestion(uint256 questionId) external view returns (Question memory)
```

`getQuestion` copies the stored question into memory and returns the copy. That
copy disappears after the call finishes. Changing a memory copy would not
change the original question in storage.

### calldata

`calldata` is read-only input sent to an external function.

```solidity
function createQuestion(string calldata text)
```

The caller supplies `text`. The function can read it, but it cannot directly
change the calldata value. Using calldata for external inputs is usually
efficient because Solidity does not first make an unnecessary memory copy.

In short:

| location | purpose | permanent? | can this code change it? |
| --- | --- | --- | --- |
| `storage` | blockchain state | yes | yes |
| `memory` | temporary working data | no | yes |
| `calldata` | external function input | no | no |

## 5. sender, errors, and view functions

### `msg.sender`

`msg.sender` is the address that called the current function.

When a question is created, your contract saves the caller:

```solidity
creator: msg.sender,
```

When someone tries to resolve that question, the contract compares the current
caller with the saved creator:

```solidity
if (msg.sender != question.creator) revert NotCreator();
```

If the addresses are different, the operation stops.

### custom errors and `revert`

Your contract defines three custom errors:

```solidity
error EmptyQuestion();
error NotCreator();
error AlreadyResolved();
```

An error describes why an operation failed. For example:

```solidity
if (bytes(text).length == 0) revert EmptyQuestion();
```

`bytes(text).length` counts the bytes in the string. If the length is zero, the
question is empty. `revert EmptyQuestion()` stops the function, cancels its
state changes, and returns the named error.

This line prevents someone other than the creator from resolving a question:

```solidity
if (msg.sender != question.creator) revert NotCreator();
```

This line prevents the outcome from being changed after resolution:

```solidity
if (question.resolved) revert AlreadyResolved();
```

Solidity also supports `require(condition, "message")`. It checks a condition
and reverts with a text message when the condition is false. Your contract does
not use `require`. It uses custom errors instead. Custom errors are clear to
test and usually use less gas than long error strings.

### `view`

A `view` function can read contract state but cannot change it.

```solidity
function getQuestion(uint256 questionId) external view returns (Question memory)
```

This reads and returns one question.

```solidity
function questionCount() external view returns (uint256)
```

This reads the array length. Calling a view function directly does not create a
state-changing transaction.

### other important function words

`external` means a function is designed to be called from outside the contract.

```solidity
returns (uint256 questionId)
```

This says `createQuestion` returns an unsigned whole number named `questionId`.
`uint256` cannot hold a negative value.

The new id is calculated before the question is added:

```solidity
questionId = questions.length;
```

If there are no questions, the length is `0`, so the first id is `0`.

The new struct is then added to the array:

```solidity
questions.push(Question({
    text: text,
    creator: msg.sender,
    resolved: false,
    outcome: false
}));
```

Every new question begins unresolved. Its initial outcome is also `false`, but
that value should not be treated as final until `resolved` becomes `true`.

## 6. events

Events are records written to the blockchain transaction log. Applications,
block explorers, and test code can watch these logs. Events make important
contract actions easier to find without repeatedly reading all contract state.

Your contract declares two events:

```solidity
event QuestionCreated(uint256 indexed questionId, address indexed creator, string text);
event QuestionResolved(uint256 indexed questionId, bool outcome);
```

The contract emits the first event after saving a question:

```solidity
emit QuestionCreated(questionId, msg.sender, text);
```

It emits the second event after saving an outcome:

```solidity
emit QuestionResolved(questionId, outcome);
```

`indexed` makes an event field easier for applications to filter. For example,
an application could search for events from one creator or one question id.

An event is useful for history and notifications, but it is not a replacement
for contract storage. Your contract stores its current state in `questions` and
uses events to announce changes.

## 7. how the five tests verify the contract

The test file imports strict assertions and Node's test tools:

```typescript
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
```

- `describe` groups related tests.
- `it` defines one expected behavior.
- `beforeEach` runs before every test.
- `assert.equal` checks that an actual value equals an expected value.

Hardhat creates a temporary local blockchain:

```typescript
const { viem } = await network.create();
```

Viem is the library the tests use to deploy and call the contract.

The tests get two temporary accounts:

```typescript
const [creator, otherAccount] = await viem.getWalletClients();
```

These are local test accounts. They are not real wallets or production keys.

Before every test, this code deploys a fresh contract:

```typescript
beforeEach(async function () {
  registry = await viem.deployContract("QuestionRegistry");
});
```

Using a new contract keeps each test independent. One test cannot leave data
that accidentally changes another test.

### test 1: creates and stores a question

The first test calls:

```typescript
registry.write.createQuestion(["Will the local test pass?"])
```

`write` is used because creating a question changes contract state. The test
expects a `QuestionCreated` event with id `0`, the creator's address, and the
correct text:

```typescript
await viem.assertions.emitWithArgs(
  registry.write.createQuestion(["Will the local test pass?"]),
  registry,
  "QuestionCreated",
  [0n, creator.account.address, "Will the local test pass?"],
);
```

The `n` in `0n` and `1n` means JavaScript `bigint`. Ethereum's `uint256` values
can be larger than normal JavaScript numbers, so Viem represents them this way.

The test confirms there is one question:

```typescript
assert.equal(await registry.read.questionCount(), 1n);
```

It then reads question `0` and checks every field. The address strings are
changed to lowercase only for comparison because letter case in an Ethereum
address should not make these two matching addresses fail the test.

### test 2: lets the creator resolve a question

This test creates a question and resolves it with `true`:

```typescript
await registry.write.resolveQuestion([0n, true]);
```

It verifies the `QuestionResolved` event contains id `0` and outcome `true`.
It then reads the stored question and confirms both important changes:

```typescript
assert.equal(question.resolved, true);
assert.equal(question.outcome, true);
```

### test 3: rejects an empty question

This test tries to create a question using an empty string:

```typescript
registry.write.createQuestion([""])
```

It passes only if the call fails with the contract's `EmptyQuestion` custom
error. This proves the validation is active and checks the exact failure reason.

### test 4: rejects another account

This test creates a question with the default creator account. It then calls
`resolveQuestion` using `otherAccount`:

```typescript
registry.write.resolveQuestion(
  [0n, true],
  { account: otherAccount.account },
)
```

It expects `NotCreator`. This proves that the saved creator check uses the
caller's address and blocks a different account.

### test 5: rejects a second resolution

This test creates a question and resolves it once with `true`. It then tries to
resolve the same question again with `false`.

The test expects `AlreadyResolved`. This proves that an outcome cannot be
changed after the first successful resolution.

Together, the tests cover two successful operations and three expected
failures. They run on an in-memory blockchain, which disappears after the test
command finishes.

## 8. current abilities and missing prediction-market features

The current contract can:

- create a question with text and a creator;
- assign each question a numeric id;
- count and read saved questions;
- let only the creator resolve their question;
- store a boolean outcome;
- prevent empty questions and repeated resolution; and
- emit logs when questions are created or resolved.

It is still a question registry, not a prediction market. A useful prediction
market would need several carefully designed parts that are not present here:

- outcome tokens or positions that users can hold;
- collateral such as an ERC-20 token;
- rules for buying, selling, splitting, or merging positions;
- payout and redemption calculations;
- reliable outcome resolution, normally using an oracle or dispute process;
- market timing, such as opening and closing times;
- support for more than a simple true-or-false result when needed;
- protection against economic and smart-contract attacks;
- handling for invalid or cancelled markets;
- access-control and governance decisions; and
- a professional security review and much more testing.

The current creator decides the outcome alone. That is useful for learning
authorization, but it is not trustworthy enough for a real market where money
is at risk. The contract also does not accept funds, issue tokens, calculate
odds, or pay winners.

The Gnosis Conditional Token Framework can later help represent conditional
positions and payouts. It should be studied separately after the basic Solidity
and Hardhat ideas in this contract are clear.

## check your understanding

1. Why does the first question receive id `0`?
2. What changes in permanent storage when `resolveQuestion` succeeds?
3. Why does `createQuestion` use `calldata` for its text input?
4. What is the difference between the `resolved` value and the `outcome` value?
5. Which test proves that a different account cannot resolve a question?
