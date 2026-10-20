# My Blockchain Learning Project Guide

I wrote this as the central handbook for my project in:

```text
F:\Learning-Blockchain\blockchain
```

I use it to remember what I built, what I verified, how the pieces work
together, and what I still need to learn. I keep the language simple so I can
understand the code myself instead of only copying it.

> **My safety rule:** this is my local learning project. It is not audited,
> production-ready, or publicly deployed. I will not use real funds or
> production private keys with these exercises.

## 1. Project overview

### What I am building

I use this Hardhat 3 workspace to learn:

- Solidity smart contracts;
- automated contract testing with Viem;
- ERC-20 fungible tokens;
- ERC-1155 multi-token contracts;
- contract-to-contract calls;
- Gnosis Conditional Token Framework concepts;
- condition, collection, and position identifiers; and
- a local adapter that interacts with the actual Gnosis CTF v1.0.3 contract.

The learning path moves from small contracts to a complete local CTF lifecycle:

```text
QuestionRegistry
       |
       v
QuestionReader
       |
       v
ERC-20 and ERC-1155 practice
       |
       v
Educational CTF lifecycle mock
       |
       v
CTF identifier calculations
       |
       v
LocalCTFAdapter + actual Gnosis ConditionalTokens
       |
       v
Complete local integration tests
```

### What my current code can do

My current project can locally:

- create, read, and resolve simple true/false questions;
- create and transfer an ERC-20 practice token;
- create and transfer two ERC-1155 token types;
- demonstrate simplified split, merge, resolve, and redeem accounting;
- calculate CTF condition, root collection, and position IDs;
- compile the official Gnosis CTF v1.0.3 source with Solidity 0.5.10;
- compile the modern learning contracts with Solidity 0.8.34;
- prepare a real local CTF binary condition;
- split collateral through the actual local CTF contract;
- merge matching CTF positions back into collateral;
- report an authorized YES result;
- redeem winning and losing positions; and
- verify ownership, approvals, balances, failures, and transaction rollback.

### What my project cannot do yet

I have not added these parts yet:

- a frontend;
- a backend or database;
- wallet-browser integration;
- deployment scripts;
- public-network configuration;
- a market maker, order book, prices, or liquidity;
- market opening and closing times;
- a production oracle or dispute process;
- a production-ready CTF adapter;
- support for nested CTF collections in the educational ID helper;
- a security audit; or
- monitoring, indexing, administration, or governance tools.

### How I separate practice from production

| Learning project | Production prediction market |
| --- | --- |
| Uses fake local accounts and funds | Handles valuable user assets |
| Focuses on one concept at a time | Combines many complex systems |
| Uses simplified mocks where clearly labelled | Must use reviewed production contracts |
| Can use a simple test oracle | Needs a trustworthy oracle and dispute process |
| Tests known examples | Needs extensive security, economic, and adversarial testing |
| Runs on an in-memory network | Runs persistently on a selected blockchain |
| Has not been audited | Should receive professional audits |

Passing tests prove only the tested behavior. They do not prove that a contract
is secure under every possible input or attack.

## 2. Blockchain fundamentals

### Blockchain

A blockchain is a shared record of transactions. Many computers agree on the
same ordered history. A user cannot normally edit an old confirmed transaction
as if it were a normal database row.

Practical example: when 10 collateral tokens are locked in the local CTF
contract, the token balances record that movement. On a real network, many
nodes would agree on those balances.

### Ethereum

Ethereum is a blockchain platform that can execute programs called smart
contracts. Ethereum-compatible networks follow the same general EVM rules and
can often run the same compiled contracts.

### Smart contract

A smart contract is a program stored and executed on a blockchain. It has:

- code, such as `QuestionRegistry.createQuestion`; and
- state, such as the stored list of questions.

A contract cannot secretly make an HTTP request or read a normal database by
itself. External information normally arrives through transactions, often from
an oracle.

### Solidity

Solidity is the programming language I use for the contracts in this project.
Files end in `.sol`.

```solidity
contract QuestionRegistry {
    // contract code
}
```

### Transaction

A transaction requests a state-changing operation. For example:

```typescript
await registry.write.createQuestion(["Will the test pass?"]);
```

This changes state, so Viem uses `write`. A read such as `questionCount()` does
not change state and uses `read`.

### Wallet and wallet address

A wallet controls an account using a private key. Its address is the public
identifier, such as `0x1234...`.

The tests use temporary Hardhat accounts:

```typescript
const [oracle, user] = await viem.getWalletClients();
```

These are local test accounts, not real funded wallets. A private key proves
control of an account and must never be committed or shared.

### Gas fees

Gas measures EVM computation and storage work. On a public network, the sender
pays a gas fee. Local Hardhat tests simulate transactions without spending real
money.

Storage writes generally cost more gas than reads. Custom errors usually use
less gas than long revert strings.

### ABI

ABI means Application Binary Interface. It describes how outside code calls a
contract: function names, argument types, return types, events, and errors.

`IConditionalTokens.sol` is a Solidity view of the official CTF ABI subset used
by the adapter. Contracts compiled by different Solidity versions can interact
when their ABI encoding matches.

### Bytecode

Bytecode is the machine-level instruction sequence executed by the EVM.
Hardhat's compiler creates bytecode and ABI artifacts from Solidity source.

### EVM network

EVM means Ethereum Virtual Machine. An EVM network executes Ethereum-style
bytecode. Ethereum mainnet, many other chains, testnets, and Hardhat's local
network are EVM environments.

### Local blockchain testing

Hardhat creates a temporary in-memory blockchain for the tests. Contracts are
deployed, called, and inspected just like blockchain contracts, but everything
disappears after the test process ends.

### Testnet and mainnet

- A **testnet** is a persistent public practice network using test currency.
- A **mainnet** is a production network where assets can have real value.

This repository is configured for neither. It currently tests locally only.

### Oracle

An oracle supplies outside results to a smart contract. In the CTF integration
tests, a designated local account is the oracle. It reports a YES result with:

```typescript
await ctf.write.reportPayouts([questionId, [1n, 0n]]);
```

The vector `[1, 0]` gives the first outcome the payout and the second outcome
none. This local account is not a production oracle system.

### ERC standard

An ERC is a shared Ethereum contract interface or behavior standard.

- ERC-20 describes fungible tokens.
- ERC-1155 describes a contract that manages balances for multiple token IDs.

Standards let wallets, applications, and contracts know how to interact with a
token without learning a completely different API each time.

## 3. Project architecture

### Current implemented architecture

```text
Local test account
    |
    | Viem calls
    v
LocalCTFAdapter (Solidity 0.8.34)
    |                         |
    | ERC-20 transfers        | official CTF ABI calls
    v                         v
MockCollateral          Gnosis ConditionalTokens v1.0.3
(OpenZeppelin ERC-20)        (Solidity 0.5.10)
                              |
                              | ERC-1155 position balances
                              v
                         Local test accounts

All components run inside Hardhat's temporary local EVM network.
```

The educational mock and ID helper are separate branches:

```text
EducationalCTFMock
    -> simplified teaching behavior only
    -> not proof of real CTF compatibility

EducationalCTIdHelpers
    -> accurate supported root-level ID examples
    -> deliberately rejects nested parent collections
```

### Future possible architecture

The following is a possible future design, not implemented code:

```text
User
  -> Frontend (not present)
  -> Browser wallet (not integrated)
  -> Adapter / application contracts
  -> Gnosis ConditionalTokens
  -> EVM blockchain

Optional backend (not present)
  -> reads indexed events
  -> serves searchable market data
  -> stores off-chain display data in a database
```

A backend should not be trusted to rewrite on-chain ownership. It may index
events and provide convenient queries. A frontend displays data and asks a
wallet to sign transactions. Neither exists in the current repository.

## 4. Project folder structure

The important current structure is:

```text
blockchain/
|-- .gitignore
|-- BLOCKCHAIN_PROJECT_GUIDE.md
|-- README.md
|-- hardhat.config.ts
|-- package.json
|-- package-lock.json
|-- tsconfig.json
|-- contracts/
|   |-- QuestionRegistry.sol
|   |-- QuestionReader.sol
|   |-- PracticeToken.sol
|   |-- PracticePositions.sol
|   |-- ctf-practice/
|   |   |-- MockCollateral.sol
|   |   `-- EducationalCTFMock.sol
|   |-- ctf-id-practice/
|   |   |-- EducationalCTIdHelpers.sol
|   |   `-- EducationalCTIdHarness.sol
|   `-- ctf-adapter/
|       |-- IConditionalTokens.sol
|       `-- LocalCTFAdapter.sol
|-- test/
|   |-- QuestionRegistry.ts
|   |-- QuestionReader.ts
|   |-- PracticeToken.ts
|   |-- PracticePositions.ts
|   |-- ctf-practice/EducationalCTFMock.ts
|   |-- ctf-id-practice/EducationalCTIds.ts
|   |-- ctf-adapter/LocalCTFAdapter.ts
|   `-- ctf-integration/CompleteCTFLifecycle.ts
`-- docs/
    |-- README.md
    |-- SOLIDITY_EXPLAINED.md
    |-- QUESTION_READER_REVIEW.md
    |-- TOKEN_EXERCISE.md
    |-- CTF_MOCK_EXERCISE.md
    |-- CTF_ID_EXERCISE.md
    `-- CTF_ADAPTER_EXERCISE.md
```

Generated or installed directories also exist locally:

- `node_modules/` contains installed npm packages.
- `artifacts/` contains generated ABIs, bytecode, and build information.
- `cache/` helps Hardhat avoid unnecessary recompilation.

They are ignored by Git and should not be manually edited.

There is no `scripts/` directory and no deployment script. There is also no
frontend, backend, database, `.env`, or `.env.example` file at present.

`.gitignore` excludes `.env` and `.env.*`, while allowing a future safe
`.env.example`. Real secrets must never be placed in the example file.

## 5. Development environment

### Verified tool versions

At the latest inspection:

| Tool | Version |
| --- | --- |
| Node.js | 25.7.0 |
| npm | 11.10.1 |
| Git | 2.54.0.windows.1 |
| Hardhat | 3.20.0 |
| Hardhat Viem toolbox | 5.0.7 |
| OpenZeppelin Contracts | 5.6.1 |
| Gnosis Conditional Tokens package | 1.0.3 |

`package-lock.json` records exact installed dependency versions. Commit it so
other developers can reproduce the dependency tree.

### Why `npm.cmd` is used

PowerShell on this computer blocks the unsigned `npm.ps1` shim. The Windows
command shim works:

```powershell
npm.cmd --version
```

If normal `npm` works in another terminal, it can be used there.

### Install dependencies

From the project directory:

```powershell
cd F:\Learning-Blockchain\blockchain
npm.cmd install
```

The official CTF dependency brings in legacy `openzeppelin-solidity 2.3.0`.
The last audit reported two moderate advisories with no fix in that dependency
line. This is an important production risk.

### Compiler configuration

`hardhat.config.ts` uses two compilers:

- Solidity 0.8.34 with optimizer enabled and 200 runs for modern project code.
- Solidity 0.5.10 with optimizer enabled and 200 runs for official CTF v1.0.3.

`npmFilesToBuild` tells Hardhat to compile the installed official file:

```text
@gnosis.pm/conditional-tokens-contracts/contracts/ConditionalTokens.sol
```

The compiler version was not silently replaced. Each source is compiled with a
version compatible with its own `pragma`.

### Compile

```powershell
npm.cmd run compile
```

Force a clean recompilation when checking both compiler groups:

```powershell
npm.cmd run compile -- --force
```

A previously verified forced build reported:

```text
Compiled 1 Solidity file with solc 0.5.10
Compiled 8 Solidity files with solc 0.8.34
```

### Run all tests

```powershell
npm.cmd test
```

The latest verified full result on 2026-10-20 was:

```text
37 passing (37 nodejs)
```

### Run one test file

Hardhat 3 accepts a test file as a positional argument. This command was
verified successfully:

```powershell
npm.cmd exec hardhat -- test test\QuestionRegistry.ts
```

Its verified result was:

```text
5 passing (5 nodejs)
```

Another example is:

```powershell
npm.cmd exec hardhat -- test test\ctf-integration\CompleteCTFLifecycle.ts
```

### Inspect failures

Read the first failing test and its stack trace. For more detail:

```powershell
npm.cmd exec hardhat -- test --show-stack-traces
```

Typical failure information includes the test name, expected value, actual
value, revert error, and source line. Do not change a test merely to hide a real
contract bug. First decide whether the contract or the expectation is wrong.

### Git status

```powershell
git status --short --branch
```

My project is currently a Git repository on branch `main`. At inspection time,
there were uncommitted CTF adapter, integration, configuration, package, and
documentation changes. Review `git status` again before committing.

## 6. Solidity basics I use in this project

### `pragma`

```solidity
pragma solidity ^0.8.34;
```

This allows compatible compiler versions starting at 0.8.34 but below 0.9.0.
Hardhat currently selects exactly 0.8.34 for these files.

The official CTF source uses the older 0.5 compiler family. Old source must not
be copied blindly into modern Solidity because language rules and library APIs
have changed.

### Contract

A contract groups state and behavior:

```solidity
contract QuestionRegistry { ... }
```

### Interface

An interface describes how to call another contract without containing that
contract's implementation:

```solidity
interface IQuestionRegistry {
    function questionCount() external view returns (uint256);
}
```

`IConditionalTokens` similarly describes the official functions used by the
adapter.

### Import

An import reuses code from another file or package:

```solidity
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
```

The token exercises inherit reviewed OpenZeppelin implementations rather than
reimplementing token standards from scratch.

### State variables

State variables persist in contract storage:

```solidity
Question[] private questions;
bool public resolved;
IConditionalTokens public immutable ctf;
```

- `private` limits direct Solidity access.
- `public` creates an automatic read function.
- `immutable` means the constructor sets the value once.
- `constant` means the value is fixed in the code.

### Struct

A struct groups related values:

```solidity
struct Question {
    string text;
    address creator;
    bool resolved;
    bool outcome;
}
```

This keeps one question's text, creator, and result together.

### Arrays and mappings

`Question[]` is a growing array. Array positions start at zero.

My project-owned learning contracts do not currently declare a Solidity
`mapping`. The imported official CTF implementation does use mappings for data
such as payouts. A mapping is like a key-value lookup table:

```solidity
// additional learning example, not declared in the project-owned contracts
mapping(address => uint256) balances;
```

### Constructor

A constructor runs once during deployment:

```solidity
constructor(address registryAddress) {
    registry = IQuestionRegistry(registryAddress);
}
```

The adapter constructor validates and stores the actual CTF and collateral
addresses.

### Functions and visibility

- `external`: intended for calls from outside the contract.
- `public`: callable internally and externally.
- `internal`: usable by the contract and children.
- `private`: usable only inside the declaring contract.

Examples include external `createQuestion`, public `getBinaryConditionId`, and
private `_requireBinaryCondition`. OpenZeppelin exposes internal `_mint` and
`_mintBatch` helpers to inheriting contracts.

### `view` and `pure`

- `view` reads state but cannot change it.
- `pure` cannot read or change contract state.

```solidity
function questionCount() external view returns (uint256)
```

```solidity
function _binaryIndexSets() private pure returns (uint256[] memory)
```

### `storage`, `memory`, and `calldata`

| Location | Meaning | Project example |
| --- | --- | --- |
| `storage` | Permanent blockchain state | `Question storage question = questions[questionId]` |
| `memory` | Temporary function data | returned `Question memory` and temporary arrays |
| `calldata` | Read-only external input | `string calldata text` |

A storage reference updates the real saved value. A memory value is temporary.
Calldata avoids an unnecessary input copy and cannot be modified directly.

### `msg.sender`

`msg.sender` is the immediate caller. `QuestionRegistry` saves it as the
question creator. CTF also uses the reporting caller as the oracle when deriving
the condition ID.

Contract-to-contract calls change `msg.sender`. When the adapter calls CTF,
CTF sees the adapter as `msg.sender`, not the original user. This is why the
adapter must explicitly move tokens before and after CTF calls.

### `require`, custom errors, and `revert`

Project-owned modern contracts mainly use custom errors:

```solidity
if (amount == 0) revert ZeroAmount();
```

The official legacy CTF uses `require` with text messages. Both stop execution
when validation fails. Custom errors are generally smaller and easier to test
precisely.

### Events and `emit`

Events create transaction log records:

```solidity
event QuestionResolved(uint256 indexed questionId, bool outcome);
emit QuestionResolved(questionId, outcome);
```

Applications can search logs efficiently. `indexed` fields can be filtered.
Events describe history; storage remains the source for current state.

### Modifiers

The adapter uses OpenZeppelin's `nonReentrant` modifier:

```solidity
function splitBinary(...) external nonReentrant
```

It prevents the protected function from being entered again before the first
call finishes. I have not defined my own modifier yet.

### Address and payable

`address` represents an EVM account or contract address. The adapter rejects
zero addresses and checks that configured contract addresses contain code.

My project-owned contracts do not currently use `address payable` or receive
native ETH. That concept would be an additional future lesson.

### `bytes32`

`bytes32` is exactly 32 bytes. CTF uses it for question IDs, condition IDs, and
collection IDs. It is compact and works naturally with `keccak256` output.

### Enums

None of my project-owned contracts currently uses an enum. An enum is a named set of
choices, such as `Open`, `Closed`, and `Resolved`. That would be an additional
learning example, not a current feature.

### Inheritance

Inheritance reuses a parent contract:

```solidity
contract PracticeToken is ERC20
```

`LocalCTFAdapter` inherits `ERC1155Holder` so it can safely receive ERC-1155
tokens and `ReentrancyGuard` for call protection.

### External contract calls

```solidity
ctf.splitPosition(collateral, ROOT_COLLECTION, conditionId, partition, amount);
```

This is one contract calling another. The external call can succeed, return
data, or revert.

### Atomic rollback

A transaction is atomic: either every step succeeds, or all state changes from
that transaction are rolled back. The tests prove that failed early redemption
does not leave the user's positions stuck in the adapter.

## 7. QuestionRegistry and QuestionReader

### QuestionRegistry responsibility

`QuestionRegistry` stores simple questions. Each `Question` has:

| Field | Meaning |
| --- | --- |
| `text` | The written question |
| `creator` | Address that created it |
| `resolved` | Whether a final result exists |
| `outcome` | The true/false result |

Important functions:

- `createQuestion(string)` rejects empty text, stores the creator, and returns
  the new array index.
- `resolveQuestion(uint256,bool)` allows only that question's creator and only
  one resolution.
- `getQuestion(uint256)` returns the stored struct.
- `questionCount()` returns the array length.

Events announce creation and resolution. Custom errors explain empty text,
wrong callers, and repeated resolution.

### QuestionReader responsibility

`QuestionReader` demonstrates contract-to-contract reading. Its constructor
stores an `IQuestionRegistry` reference. `readQuestion` first checks
`questionCount`, then calls `getQuestion`.

```text
caller
  -> QuestionReader.readQuestion(0)
  -> QuestionRegistry.questionCount()
  -> QuestionRegistry.getQuestion(0)
  -> returned Question struct
```

`InvalidQuestionId(id, count)` gives a clearer failure than a raw array panic.

### Verified tests

The registry tests verify creation, resolution, empty-text rejection,
creator-only resolution, and one-time resolution. Reader tests verify a real
cross-contract read and invalid ID rejection.

### Limitations

- The question creator decides the result alone.
- There is no oracle or dispute system.
- Questions have only a boolean result.
- There are no outcome tokens, collateral, trading, or payouts.
- `QuestionReader` does not validate its constructor address.

These contracts teach Solidity; they are not a prediction market.

## 8. ERC-20 and ERC-1155 exercises

### PracticeToken

`PracticeToken` inherits OpenZeppelin ERC-20. Its constructor creates a fixed
supply:

```solidity
1_000_000 * 10 ** 18
```

The token is named `Practice Token` with symbol `PTK`. All supply goes to the
deployer. There is no public mint function.

Its tests verify metadata, total supply, initial balances, transfers, and that
a transfer does not change total supply.

### PracticePositions

`PracticePositions` inherits OpenZeppelin ERC-1155. One contract manages:

- ID `0`: illustrative YES;
- ID `1`: illustrative NO.

The deployer receives 100 of each. Tests prove the IDs and balances are
independent and can be transferred separately.

This contract is not Gnosis CTF. The names YES and NO do not create a condition,
oracle, collateral relationship, or payout rule.

### MockCollateral

`MockCollateral` is another OpenZeppelin ERC-20 used only by local CTF lessons.
Its constructor creates 100 MOCK tokens for the deployer.

## 9. Educational CTF lifecycle mock

`EducationalCTFMock` teaches the balance idea with fixed IDs:

```text
YES_POSITION = 0
NO_POSITION  = 1
```

Its simplified lifecycle is:

```text
10 collateral
    --splitPosition-->
10 YES + 10 NO

10 YES + 10 NO
    --mergePositions-->
10 collateral

oracle reports YES
10 YES
    --redeemPositions-->
10 collateral
```

The mock tests cover balances, insufficient merge balances, early redemption,
and a YES payout.

This is mock-only behavior. It omits real CTF condition hashes, curve-based
collection IDs, partitions, nested positions, generalized payouts, and the
official contract implementation.

## 10. CTF identifier calculations

### Condition ID

The official method is:

```solidity
keccak256(abi.encodePacked(oracle, questionId, outcomeSlotCount))
```

It binds one oracle, question ID, and number of outcomes.

### Collection ID

Collection inputs are:

```text
parent collection ID + condition ID + outcome index set
```

The official algorithm does not stop at a normal hash. It hashes the condition
and index set, maps that value onto the BN254 elliptic curve, optionally adds a
parent curve point, and compresses the result.

For a binary condition:

```text
1 (binary 01) = first outcome, called YES in these lessons
2 (binary 10) = second outcome, called NO
```

### Position ID

The official method hashes the collateral contract address with a collection:

```solidity
uint256(keccak256(abi.encodePacked(collateralToken, collectionId)))
```

The result is used as an ERC-1155 position token ID.

### Educational helper status

`EducationalCTIdHelpers` matches official published vectors for supported root
collections. Its tests also compare direct packed hashes independently through
Viem. It intentionally rejects non-zero parent collections because nested
curve-point addition was not implemented.

`EducationalCTIdHarness` exposes the library's internal functions to tests.
Neither file is an audited replacement for official `CTHelpers`.

## 11. Actual CTF adapter and complete lifecycle

### Real implementation versus mocks

The integration tests deploy the actual `ConditionalTokens` artifact compiled
from:

```text
@gnosis.pm/conditional-tokens-contracts 1.0.3
```

Therefore these tests provide genuine local ABI and behavior integration for
the covered paths. They do not use `EducationalCTFMock` as proof.

### IConditionalTokens

The interface includes the exact ABI-compatible functions used by the adapter:

- `getConditionId`
- `getCollectionId`
- `getPositionId`
- `getOutcomeSlotCount`
- `payoutDenominator`
- `splitPosition`
- `mergePositions`
- `redeemPositions`
- `balanceOf`
- `safeBatchTransferFrom`
- `setApprovalForAll`

Old Solidity `uint` and modern `uint256` have the same ABI type. `IERC20` is
encoded as an address.

### Adapter scope

`LocalCTFAdapter` supports:

- one immutable collateral contract;
- root collections only;
- binary conditions only;
- YES index set 1 and NO index set 2; and
- atomic forwarding of assets to the caller.

It validates zero addresses, missing code, zero amounts, unprepared or
non-binary conditions, and unexpected adapter-held position balances.

### Complete split flow

```text
1. Oracle prepares the two-outcome condition in actual CTF.
2. User owns MOCK collateral.
3. User calls collateral.approve(adapter, 10).
4. User calls adapter.splitBinary(oracle, questionId, 10).
5. Adapter pulls 10 collateral from user.
6. Adapter temporarily approves actual CTF.
7. Actual CTF locks 10 collateral.
8. Actual CTF mints 10 YES and 10 NO to adapter.
9. Adapter explicitly forwards both positions to user.
10. Adapter finishes holding none of those assets.
```

CTF gives positions to the adapter because the adapter is `msg.sender` in the
CTF call. The final transfer to the user is explicit; it is not automatic.

### Complete merge flow

The user first grants ERC-1155 operator approval:

```typescript
ctf.setApprovalForAll(adapter.address, true)
```

Then:

```text
1. User calls adapter.mergeBinary(..., 10).
2. Adapter pulls 10 YES and 10 NO from user.
3. Adapter calls actual CTF mergePositions.
4. CTF burns the matching pair.
5. CTF returns 10 collateral to adapter.
6. Adapter explicitly transfers 10 collateral to user.
```

ERC-20 approval for splitting and ERC-1155 operator approval for merge/redeem
are different permissions.

### Resolution and redemption flow

The authorized oracle reports YES:

```typescript
ctf.reportPayouts([questionId, [1n, 0n]])
```

Then a holder calls `adapter.redeemBinary`:

```text
1. Adapter reads the holder's YES and NO balances.
2. Adapter pulls those approved positions.
3. Adapter calls actual CTF redeemPositions.
4. CTF burns the positions.
5. CTF pays winning collateral to adapter.
6. Adapter measures the exact received amount.
7. Adapter explicitly transfers that payout to the same caller.
```

The complete integration suite separates the positions between two accounts.
After YES wins, the YES-only holder receives 10 collateral and the NO-only
holder receives zero. Both redeemed position balances become zero.

## 12. Automated test coverage

### Verified full result

The latest run completed successfully:

```text
37 passing (37 nodejs)
```

### What is verified

| Area | Verified behavior |
| --- | --- |
| QuestionRegistry | Creation, resolution, validation, authorization |
| QuestionReader | Cross-contract reads and invalid IDs |
| ERC-20 | Fixed supply, balances, transfer |
| ERC-1155 practice | Separate IDs, balances, transfers |
| Educational CTF mock | Split, merge, early failure, YES redemption |
| ID helper | Official vector, determinism, distinct inputs, ID relationship |
| Adapter + actual CTF | Address checks, approvals, split, merge, redeem |
| Complete integration | Preparation, custody, unauthorized oracle, insufficient balances, winner and loser payouts |

The actual integration suite also verifies atomic rollback: failed merging or
early redemption does not leave tokens inside the adapter.

### Implemented but not sufficiently tested

- Constructor rejection of every possible wrong-but-nonzero contract address.
- Malicious or nonstandard ERC-20 collateral behavior.
- Fee-on-transfer and rebasing tokens.
- Gas limits and performance under large workloads.
- Fuzz tests and invariant tests.
- Reentrancy attempts using hostile token receiver contracts.
- Partial payout vectors such as `[1, 1]`.
- Many simultaneous users and repeated partial operations.

### Mock-only behavior

`EducationalCTFMock` is intentionally simplified. Its passing tests do not
prove official CTF behavior. Official behavior is separately tested by
`LocalCTFAdapter.ts` and `CompleteCTFLifecycle.ts`.

## 13. Security model and risks

### Existing protections

- OpenZeppelin ERC-20 and ERC-1155 implementations are reused.
- `SafeERC20` handles token calls defensively.
- `ReentrancyGuard` protects adapter state-changing entry points.
- Constructor addresses are checked for zero and contract code.
- The adapter rejects unexpected pre-existing position balances.
- Temporary CTF collateral approval is reset after a split.
- The official CTF contract enforces oracle identity through its condition ID.
- Tests verify intended final custody.

### Remaining risks

- None of my contracts has been professionally audited.
- Official CTF v1.0.3 and `openzeppelin-solidity 2.3.0` are legacy code.
- npm reports two moderate advisories in that legacy dependency line.
- A contract address containing code is not automatically a trustworthy CTF.
- The adapter is specialized and does not cover the full CTF feature set.
- An economic design can fail even when Solidity code behaves as written.
- Oracle compromise or bad resolution can determine incorrect payouts.
- Public deployment introduces gas, network, monitoring, and operational risks
  that local tests do not reproduce.

Do not treat local passing tests as an audit or production approval.

## 14. Safe Git workflow

Before committing:

```powershell
git status --short --branch
git diff
```

Confirm that none of these are staged:

```text
.env
node_modules/
artifacts/
cache/
private keys
seed phrases
API secrets
```

A simple review workflow is:

```text
1. Read the changed Solidity and tests.
2. Run npm.cmd test.
3. Inspect git diff.
4. Stage only intended source, tests, docs, and lockfile changes.
5. Commit with a message describing the lesson.
6. Push only after reviewing the commit.
```

No GitHub remote details or team process were verified from the repository, so
those require confirmation before documenting exact push commands.

## 15. Suggested next learning steps

These are planned suggestions, not implemented features:

1. Add partial split, merge, and redemption tests with multiple holders.
2. Add invariant tests proving collateral always covers winning position supply.
3. Study nested CTF collections without changing the verified root-only helper.
4. Test unusual collateral tokens in isolated adversarial tests.
5. Learn event indexing by building a read-only local script.
6. Add a persistent local Hardhat node and deployment module only when ready.
7. Study oracle and dispute designs before any public-network experiment.
8. Review current maintained alternatives and security guidance before planning
   production work around legacy CTF dependencies.

Public deployment, real funds, and production secrets should remain out of
scope until the code, dependencies, operational plan, and audits are suitable.

## 16. Quick command reference

```powershell
# enter the project
cd F:\Learning-Blockchain\blockchain

# install locked dependencies
npm.cmd install

# compile changed contracts
npm.cmd run compile

# force both compiler groups to rebuild
npm.cmd run compile -- --force

# run every test
npm.cmd test

# run one test file
npm.cmd exec hardhat -- test test\QuestionRegistry.ts

# show detailed Hardhat failures
npm.cmd exec hardhat -- test --show-stack-traces

# inspect repository changes
git status --short --branch
git diff
```

## 17. Short glossary

| Term | Simple meaning |
| --- | --- |
| ABI | Rules for calling a compiled contract |
| Address | Public identifier for an account or contract |
| Approval | Permission for another address to move tokens |
| Atomic | Everything succeeds or the complete transaction rolls back |
| Bytecode | EVM instructions produced by the compiler |
| Collateral | Asset locked to back conditional positions |
| Condition ID | Identifier for oracle + question + outcome count |
| Collection ID | Identifier for a selected set of condition outcomes |
| EVM | Machine that executes Ethereum-compatible smart contracts |
| Fungible | Every unit is interchangeable with another equal unit |
| Gas | Measurement of EVM work |
| Mainnet | Production blockchain network |
| Oracle | Source that reports an outside result on-chain |
| Position ID | ERC-1155 ID for collateral plus an outcome collection |
| Revert | Stop and roll back a failed transaction |
| Smart contract | Program executed by a blockchain |
| Testnet | Public practice blockchain |
| Transaction | Signed request that may change blockchain state |

## 18. Current completion summary

### Implemented and verified

- Solidity and Hardhat fundamentals
- Question storage and contract-to-contract reading
- ERC-20 and ERC-1155 basics
- Simplified educational CTF accounting
- Supported official CTF ID calculations
- Actual CTF v1.0.3 local compilation
- Binary condition preparation
- Adapter split, merge, and redemption
- Authorized and unauthorized resolution behavior
- Winning and losing holder payouts
- 37 passing local automated tests

### Educational only

- `EducationalCTFMock`
- `EducationalCTIdHelpers`
- all local mock collateral and accounts
- the unaudited `LocalCTFAdapter`

### Unknown or requires confirmation

- Any intended frontend or backend technology
- Database plans
- Target public network
- Production oracle choice
- Deployment addresses
- Team release and review policy
- Audit plan

### Final status

My project demonstrates a complete basic binary CTF lifecycle locally:

```text
prepare
  -> approve collateral
  -> split
  -> transfer or hold positions
  -> merge matching positions

or

prepare
  -> approve collateral
  -> split
  -> oracle resolves
  -> approve positions
  -> redeem winner and loser
```

That workflow is verified for the covered tests against the actual local
Gnosis `ConditionalTokens` implementation. It is a strong learning milestone,
but it is not yet a complete or production-ready prediction-market system.
