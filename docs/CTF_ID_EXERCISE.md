# condition, collection, and position ids

## warning

`EducationalCTIdHelpers` is a learning tool. It is not the audited Gnosis
`CTHelpers` library and must not replace the official library in production.

The official source uses Solidity `^0.5.1`. This project uses Solidity `0.8.34`.
The exercise keeps the official input types, packed encoding, hashing, curve
field, and root-collection algorithm, but updates the square-root calculation
to use the EVM modular-exponentiation precompile. It intentionally rejects
nested parent collections because the official parent-point addition code has
not been included in this first lesson.

## why cthelper exists

Gnosis CTF needs stable identifiers that any contract or application can
calculate again from the same inputs. `CTHelpers` provides the official rules.

- a condition id identifies one question, oracle, and number of outcomes;
- a collection id identifies one set of outcomes for a condition, optionally
  combined with earlier conditions; and
- a position id identifies one collection backed by one collateral token.

These values are identifiers. They are not balances and they do not deploy
contracts.

## condition id

The exact official argument types are:

```solidity
address oracle
bytes32 questionId
uint256 outcomeSlotCount
```

The official calculation is:

```solidity
keccak256(abi.encodePacked(oracle, questionId, outcomeSlotCount))
```

`abi.encodePacked` joins the binary representation of those typed values. It
does not join readable strings. `keccak256` hashes the packed bytes into one
`bytes32` condition id.

Changing the oracle, question id, or outcome count changes the packed bytes and
therefore should change the condition id.

## collection id

The exact arguments are:

```solidity
bytes32 parentCollectionId
bytes32 conditionId
uint256 indexSet
```

An index set is a bitmap. Each bit represents one outcome slot. For a binary
condition:

```text
0b01 = first outcome, labelled yes in this lesson
0b10 = second outcome, labelled no in this lesson
0b11 = both outcomes together
```

The official algorithm begins with:

```solidity
uint256 x = uint256(keccak256(abi.encodePacked(conditionId, indexSet)));
```

That hash is only the starting value. It is not yet the collection id.

The helper repeatedly tries field values until it finds an `(x, y)` point on
the BN254 curve:

```text
y² = x³ + 3  modulo P
```

`P` is the prime field used by the curve. The algorithm preserves a parity bit
derived from the original hash, then compresses the curve point into one
`bytes32` value. This curve work allows official CTF to combine parent and
child collections safely.

This exercise accurately handles root collections where:

```solidity
parentCollectionId == bytes32(0)
```

It explicitly reverts for a non-zero parent. The real helper decodes the parent
curve point and uses the EVM `ecadd` precompile to combine it with the new point.

## position id

The exact official argument types are:

```solidity
IERC20 collateralToken
bytes32 collectionId
```

The calculation is:

```solidity
uint256(keccak256(abi.encodePacked(collateralToken, collectionId)))
```

An `IERC20` contract reference is packed as its 20-byte address. The collection
id follows as 32 bytes. Hashing both means the same outcome collection backed
by a different collateral token has a different position id.

The real Conditional Tokens contract uses position ids as ERC-1155 token ids.

## binary yes and no example

Assume:

```text
oracle = the first local hardhat account
question id = 0x0000...0001
outcome count = 2
collateral = the local mock collateral address
```

The sequence is:

```text
1. condition id
   keccak256(packed oracle + question id + uint256(2))

2. yes collection id
   map packed(condition id + uint256(0b01)) onto the bn254 curve

3. no collection id
   map packed(condition id + uint256(0b10)) onto the bn254 curve

4. yes position id
   uint256(keccak256(packed collateral address + yes collection id))

5. no position id
   uint256(keccak256(packed collateral address + no collection id))
```

YES and NO share a condition and collateral, but their index sets create
different collection ids and therefore different position ids.

## files

- `contracts/ctf-id-practice/EducationalCTIdHelpers.sol` contains the learning calculations.
- `contracts/ctf-id-practice/EducationalCTIdHarness.sol` exposes them for local calls and tests.
- `test/ctf-id-practice/EducationalCTIds.ts` checks official vectors and binary examples.
- `CTF_ID_EXERCISE.md` explains the calculations and limitations.

All earlier contracts and tests remain separate.

## what the tests prove

The tests check:

- all three ids against fixed values published in the official CTF guide;
- repeated typed inputs return the same condition and collection ids;
- the Solidity condition hash matches Viem's independent packed calculation;
- changing the oracle changes the condition id;
- YES and NO index sets create different collection ids;
- the Solidity position id matches Viem's independent packed calculation;
- YES and NO collection ids lead to different position ids; and
- nested parent collections fail clearly instead of returning a false result.

## commands

From the `blockchain` directory:

```powershell
npm.cmd run compile
npm.cmd test
```

Everything runs on Hardhat's temporary local network. No public deployment,
real funds, or private keys are used.
