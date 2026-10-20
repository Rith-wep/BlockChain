# erc-20 and erc-1155 practice

This exercise runs only on Hardhat's local test network. It does not use real
funds or deploy anything to a public network.

## fungible tokens

A fungible token has interchangeable units. If two people each own one PTK,
their tokens have the same meaning and value, just like two equal coins.

`PracticeToken.sol` inherits OpenZeppelin's `ERC20` implementation. Its
constructor creates a fixed supply of 1,000,000 PTK and gives all of it to the
deployer. ERC-20 uses 18 decimals by default, so the contract stores the supply
as `1_000_000 * 10 ** 18` small units.

There is no public mint function. Transfers move existing units between
accounts without changing the total supply.

## multi-token contracts

An ERC-1155 contract can manage several token types at one contract address.
Every type has a numeric id and separate balances.

`PracticePositions.sol` uses:

- token id `0` for an illustrative YES position;
- token id `1` for an illustrative NO position; and
- an initial balance of 100 units of each id for the deployer.

Transferring YES does not change the NO balance, because they are different
token ids.

This practice contract is not Gnosis Conditional Tokens Framework. It does not
create conditions, lock collateral, split positions, merge positions, use an
oracle, report outcomes, or redeem payouts. YES and NO are only simple names
for learning how ERC-1155 ids work.

## new files

- `contracts/PracticeToken.sol` extends OpenZeppelin ERC-20 and creates the fixed PTK supply.
- `contracts/PracticePositions.sol` extends OpenZeppelin ERC-1155 and creates the YES and NO ids.
- `test/PracticeToken.ts` checks ERC-20 metadata, initial supply, balances, and a transfer.
- `test/PracticePositions.ts` checks both ids, their initial balances, and independent transfers.
- `TOKEN_EXERCISE.md` explains the exercise and its commands.

The existing question contracts and tests are unchanged.

## commands

Run these commands from the `blockchain` directory:

```powershell
npm.cmd install
npm.cmd run compile
npm.cmd test
```

`npm.cmd install` installs the exact versions recorded in `package-lock.json`.
`npm.cmd run compile` checks the Solidity and creates ABI and bytecode files in
`artifacts/`. `npm.cmd test` compiles changed files and runs every test on a
temporary local blockchain.
