# my question reader review

I wrote this review to explain my `QuestionReader.sol` contract and its tests in
simple English. This helps me check that I understand the code I built.

## verified results

I checked these facts directly from my code and test run:

- `QuestionReader` uses the real read functions from `QuestionRegistry`:
  `questionCount()` and `getQuestion(uint256)`.
- the reader receives the registry address in its constructor.
- the reader checks the question id before asking the registry for the question.
- the valid-question reader test passed.
- the invalid-id reader test passed.
- the five original registry tests also passed.
- Hardhat compiled the code with Solidity `0.8.34`.
- the complete result was `7 passing (7 nodejs)`.

The test run used Hardhat's local test network. It did not use a public network.

## 1. what is a Solidity interface?

A Solidity interface is a small description of functions that another contract
provides. It tells Solidity:

> "I expect a contract at this address to have these functions."

The interface does not contain the function code. The real function code stays
inside the other contract.

My interface is named `IQuestionRegistry`:

```solidity
interface IQuestionRegistry {
    struct Question {
        string text;
        address creator;
        bool resolved;
        bool outcome;
    }

    function getQuestion(uint256 questionId)
        external
        view
        returns (Question memory);

    function questionCount() external view returns (uint256);
}
```

The interface includes the same four `Question` fields returned by the real
registry:

- `text`
- `creator`
- `resolved`
- `outcome`

It also describes the registry's two read functions. Their names, input types,
and output types match the actual functions in `QuestionRegistry.sol`.

The interface does not include `createQuestion` or `resolveQuestion` because
the reader never calls them. Keeping only the needed functions makes the
reader's purpose easier to understand.

## 2. how does question reader call question registry?

The reader stores this contract reference:

```solidity
IQuestionRegistry public immutable registry;
```

`registry` behaves like a reference to a contract that follows the
`IQuestionRegistry` interface.

When `readQuestion` runs, it first asks the registry for its question count:

```solidity
uint256 count = registry.questionCount();
```

This is an external call from `QuestionReader` to `QuestionRegistry`.

The reader checks the requested id:

```solidity
if (questionId >= count) {
    revert InvalidQuestionId(questionId, count);
}
```

Question ids begin at zero. If the count is `1`, only id `0` exists. Id `1` is
invalid because it is equal to the count.

If the id is valid, the reader makes a second external call:

```solidity
return registry.getQuestion(questionId);
```

The registry returns the saved struct, and the reader returns the same data to
its caller.

Both interface functions and `readQuestion` are marked `view`. They read state
but do not change it.

## 3. why does the reader need the registry address?

Many contracts can have the same interface. An interface tells the reader what
functions are available, but it does not tell the reader where the real
contract is located.

A deployed contract has its own blockchain address. The reader needs the exact
address of the deployed `QuestionRegistry` that contains the questions it
should read.

The constructor receives that address:

```solidity
constructor(address registryAddress) {
    registry = IQuestionRegistry(registryAddress);
}
```

This line treats the supplied address as an `IQuestionRegistry` contract
reference:

```solidity
IQuestionRegistry(registryAddress)
```

It does not deploy a registry. It points to one that should already exist.

`immutable` means this reference is fixed when `QuestionReader` is deployed. It
cannot be changed later. If a different registry is needed, a new reader must
be deployed.

## 4. what happens if the registry address is incorrect?

### verified from the current code

The constructor does not check the address. It accepts:

- the zero address;
- a normal wallet address;
- another contract with different functions; or
- a registry chosen by mistake.

Changing an address into an interface type does not prove that the address
contains the expected contract.

If the address has no compatible contract code, a later call such as this will
normally fail:

```solidity
registry.questionCount()
```

If the address points to a different contract that happens to answer the same
function calls, the reader may receive unexpected or dishonest data.

Because the address is immutable, the current reader cannot correct a bad
address after deployment.

### not verified by the current tests

The tests do not try:

- the zero address;
- a wallet address;
- a contract with the wrong interface; or
- a different contract that copies the interface.

Therefore, the passing tests do not prove that bad registry addresses are
handled clearly. They only prove the tested behavior when the reader receives
the address of the real registry deployed in the test.

## 5. how do the tests prove the contracts work together?

Before every reader test, the code deploys a new registry:

```typescript
registry = await viem.deployContract("QuestionRegistry");
```

It then deploys a reader and gives it that registry's address:

```typescript
reader = await viem.deployContract("QuestionReader", [registry.address]);
```

This connects the two contracts on the local Hardhat network.

### test 1: reading a real question

The test creates a question directly in the registry:

```typescript
await registry.write.createQuestion([
  "Will the reader find this question?",
]);
```

It resolves question `0` with `true`:

```typescript
await registry.write.resolveQuestion([0n, true]);
```

It then reads question `0` through `QuestionReader`, not directly through the
registry:

```typescript
const question = await reader.read.readQuestion([0n]);
```

The test checks every returned field:

- the text matches;
- the creator address matches;
- `resolved` is `true`; and
- `outcome` is `true`.

This proves that, in the tested local setup, the reader can call the registry
and return the registry's saved question data.

### test 2: rejecting an invalid id

The test creates only one question. This means the count is `1` and only id `0`
is valid.

It asks the reader for id `1`:

```typescript
reader.read.readQuestion([1n])
```

The test expects this exact custom error and its values:

```text
InvalidQuestionId(1, 1)
```

The first `1` is the requested id. The second `1` is the current question
count. This proves the reader performs its clear id check in the tested case.

### what the tests do not prove

The current reader tests do not prove behavior for:

- an incorrect registry address;
- an empty registry requesting id `0`;
- several questions with different ids;
- an unresolved question;
- a dishonest contract that copies the interface; or
- behavior on a real public network.

These are test gaps, not proof that the code is broken.

## 6. security and design points to know

### no registry-address validation

The largest clear design weakness is that the constructor accepts any address.
The contract could check for a zero address or for missing contract code. Even
those checks would not prove that the address contains a trustworthy registry;
they would only catch simple mistakes.

This review does not add those checks because the request was review-only.

### the registry must be trusted

An interface describes function shapes, not honest behavior. A different
contract could implement `questionCount` and `getQuestion` but return false
information. `QuestionReader` trusts the selected address completely.

### the address cannot be updated

Using `immutable` is simple and prevents someone from secretly changing the
registry later. The trade-off is that a mistaken, replaced, or upgraded
registry cannot be selected without deploying a new reader.

### two calls are made

The reader calls `questionCount()` and then `getQuestion()`. This gives a clear
custom error, but it requires two external reads instead of one. With the
current trusted registry this is easy to understand. With an unknown or
malicious registry, the reported count and returned question should not be
assumed trustworthy.

### the interface must continue to match

The reader expects the registry's function names and types to stay compatible.
If a future registry changes the returned struct or a function signature, this
reader may no longer work with it.

### the reader does not decide whether an outcome is final

The reader returns both `resolved` and `outcome`. A caller must check
`resolved`. An unresolved question starts with `outcome == false`, but that
does not mean `false` is the final answer.

### wider registry trust issue

In the current `QuestionRegistry`, the question creator alone chooses the final
outcome. That is acceptable for practice, but it would be too centralized for
a prediction market holding real value. This issue belongs to the registry's
design, not to the reader itself.

## small call sequence example

Assume the registry is deployed at address `0xRegistry` and the reader is
deployed with that address.

```text
1. a user creates question 0 in question registry
   questionregistry.createQuestion("will it rain?")

2. an app asks question reader for question 0
   questionreader.readQuestion(0)

3. question reader asks the registry for the count
   registry.questionCount() returns 1

4. question reader checks the id
   0 is smaller than 1, so the id is valid

5. question reader asks the registry for question 0
   registry.getQuestion(0)

6. question registry returns the question struct
   text: "will it rain?"
   creator: the creator's address
   resolved: false
   outcome: false

7. question reader returns that same struct to the app
```

If the app requested id `1`, the reader would stop after the count check and
return `InvalidQuestionId(1, 1)` instead of calling `getQuestion(1)`.
