# local adapter for the actual gnosis ctf

## scope and safety

`LocalCTFAdapter` is a learning adapter for root-level binary conditions. The
tests deploy the actual Gnosis `ConditionalTokens` version 1.0.3 contract on
Hardhat's temporary local network.

The adapter is not audited and is not ready for production or real funds. It
does not deploy to a public network and contains no private keys.

## compiler compatibility

The official CTF source declares Solidity `^0.5.1`, and its own Truffle setup
pins Solidity `0.5.10`. The learning contracts use Solidity `0.8.34`.

Hardhat is configured with two compilers:

- Solidity `0.5.10` compiles the untouched official CTF npm source.
- Solidity `0.8.34` compiles the adapter and existing learning contracts.

The contracts can interact because their external ABI encoding is compatible.
They do not need to be compiled by the same compiler.

The official package depends on the old `openzeppelin-solidity 2.3.0` package.
`npm audit` reports two moderate advisories with no available fix in that legacy
dependency line. Keep this package confined to local study.

## exact interface

`IConditionalTokens.sol` declares only functions the adapter uses. Each matches
the official ABI. In the old source, `uint` means `uint256`, and an `IERC20`
contract reference is encoded as an address.

The adapter uses the official CTF contract for:

- condition, collection, and position ID calculations;
- condition outcome-count checks;
- ERC-1155 balances and transfers;
- splitting and merging positions; and
- redeeming resolved positions.

The adapter does not use the earlier educational CTF mock.

## constructor

```solidity
constructor(address ctfAddress, address collateralAddress)
```

The constructor stores one CTF address and one collateral token address. It
rejects the zero address and addresses without contract code. Both references
are immutable, so they cannot be secretly changed later.

## binary identifiers

This adapter supports one root-level partition:

```text
yes index set = 1, which represents binary 01
no index set  = 2, which represents binary 10
parent collection = bytes32(0)
outcome count = 2
```

`getBinaryConditionId` asks the actual CTF contract to use its official method:

```solidity
ctf.getConditionId(oracle, questionId, 2)
```

`getBinaryPositionIds` then asks CTF to calculate both collection IDs and both
collateral-backed ERC-1155 position IDs.

Before moving assets, `_requireBinaryCondition` verifies that CTF has a prepared
condition with exactly two outcomes.

## who owns and approves each asset?

There are three important addresses:

- the user owns collateral or outcome positions;
- the adapter temporarily moves assets during one transaction; and
- the CTF contract holds locked collateral and creates or burns positions.

The adapter does not automatically control user tokens. ERC-20 and ERC-1155
require separate approvals.

## complete split flow

Before splitting, the oracle must have prepared the binary condition directly
in CTF. The user must own collateral and approve the adapter:

```text
user -> collateral.approve(adapter, 10)
```

The user then calls:

```text
user -> adapter.splitBinary(oracle, questionId, 10)
```

Inside that one transaction:

1. the adapter validates the amount and condition;
2. the adapter pulls 10 approved collateral from the user;
3. the adapter approves the actual CTF contract to spend those 10 tokens;
4. the adapter calls the official `splitPosition`;
5. CTF pulls the collateral from the adapter and holds it;
6. CTF mints 10 YES and 10 NO positions to the adapter because the adapter was
   `msg.sender` in the CTF call;
7. the adapter explicitly transfers both position balances to the user; and
8. the adapter emits `BinaryPositionSplit`.

The final owner of the outcome positions is the user, not the adapter. If any
step fails, the whole transaction reverts.

## complete merge flow

Before merging, the user must give the adapter ERC-1155 operator approval on
the CTF contract:

```text
user -> ctf.setApprovalForAll(adapter, true)
```

This is different from ERC-20 approval.

The user calls:

```text
user -> adapter.mergeBinary(oracle, questionId, 10)
```

The adapter:

1. validates the binary condition and amount;
2. explicitly pulls 10 YES and 10 NO positions from the user;
3. calls the official `mergePositions` as the position owner;
4. CTF burns the adapter's matching positions;
5. CTF sends 10 collateral to the adapter;
6. the adapter explicitly sends those 10 collateral tokens to the user; and
7. the adapter emits `BinaryPositionsMerged`.

The adapter cannot merge the user's positions without operator approval.

## complete resolution and redemption flow

The adapter does not decide the winner. The condition's oracle reports payouts
directly to the real CTF contract. A YES result is:

```text
oracle -> ctf.reportPayouts(questionId, [1, 0])
```

The user must have already granted ERC-1155 operator approval to the adapter.
The user then calls:

```text
user -> adapter.redeemBinary(oracle, questionId)
```

The adapter:

1. reads the user's YES and NO balances;
2. explicitly pulls both balances from the user;
3. records its collateral balance before redemption;
4. calls the official `redeemPositions` with index sets `[1, 2]`;
5. CTF burns the adapter's positions and sends the winning collateral payout to
   the adapter;
6. the adapter measures the exact collateral increase;
7. the adapter explicitly transfers that payout to the user; and
8. the adapter emits `BinaryPositionsRedeemed`.

Redemption before the oracle reports a result is rejected by the actual CTF
contract, and the transaction rollback returns the user's positions.

## safety decisions

- `ReentrancyGuard` prevents nested split, merge, or redeem calls.
- `SafeERC20` handles ERC-20 transfer failures.
- temporary CTF allowance is reset to zero after a successful split.
- the adapter refuses to begin if it already holds the relevant position IDs.
  This prevents one user's positions from being mixed with another call.
- every successful operation forwards assets before it finishes.
- zero amounts, unprepared conditions, zero addresses, and non-contract
  constructor addresses are rejected.

Even with these checks, the adapter has not received a professional audit.

## files

- `contracts/ctf-adapter/IConditionalTokens.sol` contains the official ABI subset.
- `contracts/ctf-adapter/LocalCTFAdapter.sol` contains the scoped adapter.
- `test/ctf-adapter/LocalCTFAdapter.ts` tests against the actual local CTF contract.
- `hardhat.config.ts` now explicitly configures Solidity 0.5.10 and 0.8.34.
- `package.json` pins official CTF package version 1.0.3.

Previous learning contracts remain unchanged.

## test coverage

The adapter tests verify:

- zero CTF addresses are rejected;
- official CTF IDs and binary condition checks are used;
- split custody and final balances;
- missing ERC-20 approval rejects splitting;
- zero amounts and unprepared conditions are rejected;
- missing ERC-1155 approval rejects merging;
- successful merge returns collateral to the user;
- redemption before resolution fails without losing user positions; and
- a real YES payout is redeemed and forwarded to the user.

## commands

From the `blockchain` directory:

```powershell
npm.cmd install
npm.cmd run compile
npm.cmd test
```

Successful compilation reports both Solidity `0.5.10` and `0.8.34` when a
clean or forced build is performed. All contracts run only on Hardhat's local
in-memory network.
