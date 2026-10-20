# educational ctf lifecycle mock

## important warning

`EducationalCTFMock` is not the real Gnosis Conditional Token Framework. It is
a small local exercise that teaches the basic balance changes behind splitting,
merging, resolution, and redemption.

The official Gnosis `ConditionalTokens.sol` uses Solidity `^0.5.1` and an older
OpenZeppelin package. This project uses Solidity `0.8.34` and OpenZeppelin
`5.6.1`. Old source should not be copied into this project without a careful,
reviewed migration because compiler rules and library APIs have changed.

The mock deliberately leaves out real CTF features such as condition hashes,
collection IDs, index-set partitions, nested positions, ERC-1155 position-id
derivation, multiple collateral tokens, and a production oracle system.

## the learning model

There is one binary condition with two outcome token IDs:

- `YES_POSITION = 0`
- `NO_POSITION = 1`

Both are ERC-1155 balances managed by the same mock contract. Collateral is a
separate ERC-20 named MOCK. MOCK has 18 decimals, so `10 * 10 ** 18` base units
represent 10 whole collateral tokens.

## mock collateral

`MockCollateral.sol` inherits OpenZeppelin `ERC20` instead of rebuilding the
standard. Its constructor mints 100 MOCK to the deployer:

```solidity
_mint(msg.sender, INITIAL_SUPPLY);
```

The exercise user first approves the CTF mock to move 10 MOCK:

```typescript
await collateral.write.approve([ctf.address, tenTokens]);
```

Approval is needed because `splitPosition` transfers collateral from the user.

## constructor and saved addresses

The mock constructor receives the collateral address:

```solidity
constructor(address collateralAddress) ERC1155("") {
    collateral = IERC20(collateralAddress);
    oracle = msg.sender;
}
```

`collateral` tells the mock which ERC-20 backs the outcome positions. `oracle`
is the deployer in this simple lesson. Both values are immutable, so they cannot
be changed after deployment. The empty ERC-1155 URI means this exercise does
not provide token metadata.

`using SafeERC20 for IERC20` adds OpenZeppelin's safe transfer helpers to the
collateral token reference. A failed ERC-20 transfer makes the whole operation
revert.

## split position

```solidity
function splitPosition(uint256 amount) external
```

This function performs three important steps:

1. reject a zero amount;
2. transfer `amount` of collateral from the user into the mock; and
3. mint the same `amount` of both YES and NO ERC-1155 positions.

The two arrays passed to `_mintBatch` mean:

```text
mint amount of token id 0 (yes)
mint amount of token id 1 (no)
```

Splitting 10 MOCK therefore changes balances like this:

| balance | before | after |
| --- | ---: | ---: |
| user MOCK | 100 | 90 |
| mock-held MOCK | 0 | 10 |
| user YES | 0 | 10 |
| user NO | 0 | 10 |

The user receives 10 of each outcome, not five of each. Together, a matching
YES and NO pair is backed by one unit of locked collateral.

## merge positions

```solidity
function mergePositions(uint256 amount) external
```

`_burnBatch` removes the same amount of YES and NO from the caller. The mock
then sends that amount of collateral back.

Merging 10 requires at least 10 YES and 10 NO. OpenZeppelin's ERC-1155 code
reverts if either balance is too small. Because a revert cancels the complete
transaction, no positions are burned and no collateral moves when this fails.

After merging the full set from the example, the user again has 100 MOCK and
zero YES and NO.

## report payouts

```solidity
function reportPayouts(bool didYesWin) external
```

Only the saved learning oracle can call this function. Passing `true` records a
YES win. Passing `false` records a NO win. A condition can be resolved only
once.

Real CTF uses payout numerators and a denominator, which can express richer
payouts. This mock uses one boolean only to keep the first exercise readable.

## redeem positions

```solidity
function redeemPositions() external
```

Redemption first checks `resolved`. If no result exists, it reverts with
`ConditionNotResolved`.

The function reads the caller's YES and NO balances. If YES won, the payout is
the YES balance. If NO won, the payout is the NO balance. It burns both the
winning and losing balances, then returns the winning amount of collateral.

For a user holding 10 YES and 10 NO when YES wins:

| balance | before redeem | after redeem |
| --- | ---: | ---: |
| user MOCK | 90 | 100 |
| mock-held MOCK | 10 | 0 |
| user YES | 10 | 0 |
| user NO | 10 | 0 |

## tests

`test/ctf-practice/EducationalCTFMock.ts` deploys fresh contracts before every
test. It checks:

- all balances before and after splitting 10;
- all balances before and after merging a complete pair;
- a merge of 11 after splitting only 10 fails without changing balances;
- redemption before resolution fails without changing balances; and
- reporting a YES win allows redemption and burns both position balances.

Every deployment and transaction uses Hardhat's temporary in-memory network.
No public network, real funds, or private keys are involved.

## files

- `contracts/ctf-practice/MockCollateral.sol` is the local ERC-20 collateral.
- `contracts/ctf-practice/EducationalCTFMock.sol` is the simplified lifecycle harness.
- `test/ctf-practice/EducationalCTFMock.ts` tests the lifecycle and failure cases.
- `CTF_MOCK_EXERCISE.md` explains the important code and balance changes.

The question contracts and earlier token exercises are separate and unchanged.

## commands

From the `blockchain` directory, run:

```powershell
npm.cmd run compile
npm.cmd test
```

Compilation creates local ABI and bytecode artifacts. Testing deploys fresh
contracts to the local in-memory network and discards them when the run ends.
