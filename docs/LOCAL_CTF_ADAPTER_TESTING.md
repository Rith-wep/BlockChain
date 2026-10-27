# My Local CTF Adapter Tests

## What I am checking

I use these tests to learn whether `LocalCTFAdapter` can move collateral and
binary outcome positions through the official Gnosis Conditional Token
Framework (CTF). Hardhat creates a temporary local network for the tests. The
tests do not connect to Sepolia, use test ETH from a faucet, or send public
network transactions.

These results verify the tested local contracts and code paths. They do not
verify a deployed Sepolia adapter or replace a security audit.

## Contracts used by the tests

- `ConditionalTokens` is deployed locally from the project's pinned official
  Gnosis CTF package.
- `MockCollateral` is the project's practice ERC-20 token. Its deployer starts
  with 100 MOCK tokens, and the tests transfer some to the test user.
- `LocalCTFAdapter` is deployed locally with the test CTF and collateral
  addresses as constructor arguments.

The tests prepare a new binary condition before exercising it. The oracle
account calls `prepareCondition(oracle, questionId, 2)`. CTF uses the caller
that prepared the condition as its oracle. The same account must report the
payout later with `reportPayouts(questionId, payoutVector)`.

## Approvals I need to understand

ERC-20 and ERC-1155 approvals are separate:

- Before splitting, the user calls `MockCollateral.approve(adapter, amount)`.
  This lets the adapter pull the user's collateral. The adapter then approves
  CTF to use the collateral for the split.
- Before merging or redeeming, the user calls
  `ConditionalTokens.setApprovalForAll(adapter, true)`. This lets the adapter
  move the user's YES and NO ERC-1155 positions.
- The adapter does not grant either user approval automatically. The split
  test needs ERC-20 approval, while merge and redeem tests also need the
  separate ERC-1155 operator approval.

## What the existing tests cover

`test/ctf-adapter/LocalCTFAdapter.ts` covers:

- constructor rejection of zero addresses and addresses without contract code;
- a successful split and the user's, adapter's, CTF's collateral and position
  balances afterward;
- rejection of split without ERC-20 approval;
- rejection of zero split and merge amounts and an unprepared condition;
- rejection of unsolicited ERC-1155 single and batch transfers;
- rejection of merge without ERC-1155 operator approval;
- rejection of a merge when one outcome balance is too small, while checking
  that balances are preserved;
- successful merge and collateral return;
- rejection of redemption before the condition resolves;
- successful redemption of a YES win; and
- rejection of a repeated redemption after the user's positions were consumed.

`test/ctf-integration/CompleteCTFLifecycle.ts` also checks preparation and
split, merge and collateral return, an unauthorized oracle, invalid payout
vectors, an unprepared condition, redemption before resolution, and separate
YES-winning and NO-losing holders.

The current examples primarily resolve YES as the winner. Useful next local
edge cases would be a NO win (`[0, 1]`) and one combined scenario that splits,
partially merges, distributes remaining positions between holders, resolves,
and redeems each holder's positions. This would check the entire sequence and
the balance changes in one test.

## Example call sequence

For a YES-winning condition, the local test flow is:

1. The oracle calls CTF to prepare a two-outcome condition.
2. The user approves the adapter to spend collateral.
3. The user calls `adapter.splitBinary(oracle, questionId, amount)`.
4. The adapter sends the user both outcome positions.
5. The user calls `ctf.setApprovalForAll(adapter, true)` before merge or
   redemption.
6. To merge, the user calls `adapter.mergeBinary(oracle, questionId, amount)`;
   the adapter returns matching collateral.
7. To resolve instead, the same oracle calls
   `ctf.reportPayouts(questionId, [1, 0])`.
8. The user calls `adapter.redeemBinary(oracle, questionId)`; the adapter
   forwards any payout to that user.

An unresolved condition cannot be redeemed. A failed local transaction rolls
back its state changes, so the tests check balances after expected failures.

## Commands I run

From the project directory, run just the adapter and complete integration
tests:

```powershell
npm.cmd test -- --no-compile test/ctf-adapter/LocalCTFAdapter.ts test/ctf-integration/CompleteCTFLifecycle.ts
```

Run the complete existing suite:

```powershell
npm.cmd test -- --no-compile
```

`--no-compile` tells Hardhat to use the existing local build artifacts. These
commands run tests on the local Hardhat network; they do not run the Sepolia
deployment script.

## Latest local result

I ran the focused command above during this review. It reported **22 passing
tests**. No files were changed during that review. The result confirms the
current local test suite only; it does not establish that a Sepolia deployment
has the expected code or constructor addresses.
