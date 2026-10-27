# My local UMA CTF bridge implementation

Status: implemented for learning and ready for a separate bridge security review. Not deployed, audited, or approved for real funds. All contract execution in this task used local ephemeral Hardhat networks. No Sepolia reads, approvals, assertions, conditions, payouts, or deployments were performed.

## Files and dependencies

- `contracts/uma-oracle/UmaCTFOracleBridge.sol`: the application-specific oracle bridge.
- `contracts/uma-oracle/ProviderInterfaces.sol`: small ABI views for UMA Finder/whitelists and CTF resolution.
- `contracts/uma-oracle/vendor/`: two unchanged official UMA interfaces, upstream license, and provenance/checksums.
- `contracts/test/UmaBridgeFixtures.sol`: unrestricted local test contracts. These are not public deployment targets or official UMA implementations.
- `test/UmaCTFOracleBridge.ts`: 26 focused tests, including official CTF token lifecycles with mocked UMA.

The official interface revision is `c8c3f67367afd1c767712a3dbe3c8cad01b9a4d8` from [UMAprotocol/protocol](https://github.com/UMAprotocol/protocol/tree/c8c3f67367afd1c767712a3dbe3c8cad01b9a4d8). Tests verify SHA-256 checksums after normalizing line endings. Vendor notices and AGPL license are preserved; new bridge files use AGPL-3.0-only. OpenZeppelin remains 5.6.1 and official CTF remains 1.0.3. No package, lockfile, compiler configuration, existing application contract, or existing deployment script was changed.

The interfaces compile with 0.8.34. The full official UMA implementation is not imported or compiled; its separate exact-0.8.16 dependency graph remains outside this change. Compiled bridge runtime size is 13756 bytes. This is a local build fact, not a deployment verification.

## How the bridge works

Constructor arguments are `(ctfAddress, ooAddress, currency, administrator)`. The three dependencies must contain code; currency must have six decimals and be allowed by UMA's current currency whitelist. The identifier `ASSERT_TRUTH` must also be supported. Addresses/Finder are immutable. Code presence and whitelist membership do not prove a dependency is safe; deployment provenance still needs verification.

The initial configuration is fixed in code:

- Assertion liveness: **7200 seconds**.
- Bond floor: **400000000 base units**, or 400 tokens with six decimals.
- Identifier: `ASSERT_TRUTH`.
- No escalation manager or custom UMA domain.
- Outcomes: enum values **0 YES**, **1 NO**, **2 INVALID**.

The production-intended learning bond currency is verified Sepolia test USDC, not MOCK. Local tests use a six-decimal token fixture. The contract accepts a constructor-selected whitelisted six-decimal currency so it can be tested without hardcoded public-network addresses; choosing the correct USDC address remains a deployment requirement.

| Function | Purpose and permissions |
| --- | --- |
| `getQuestionId(marketId)` | Read-only domain-separated hash of version, chain, bridge, CTF, and caller-supplied unique market ID. It never generates a random nonce. |
| `createMarket(marketId, rules, evidence, invalidCriteria, deadline)` | Owner only. Requires nonzero unique ID, future deadline, and nonempty texts up to 2048 bytes each. Stores immutable rules and prepares the binary condition with this bridge as oracle. |
| `getMarket(questionId)` | Reads rules, evidence, deadline, condition ID, active/last assertion, and finalization flag. A zero deadline denotes an unknown market. |
| `requiredBond()` | Advisory quote: maximum of the fixed floor and UMA's currently cached minimum. The actual transaction refreshes UMA parameters first. |
| `buildClaim(questionId, outcome)` | Builds a human-readable claim including identities, rules hash, full texts, deadline, and proposed outcome. |
| `assertOutcome(questionId, outcome, maximumBond)` | Any funded proposer, at/after deadline. Rejects pending, accepted, finalized, unknown, or provider-inconsistent state. The caller's cap prevents an unexpected larger bond spend. |
| `assertionDisputedCallback(id)` | Only configured OOv3. Records a known active assertion's dispute; no CTF or other external call. |
| `assertionResolvedCallback(id, truthful)` | Only configured OOv3. Records acceptance/rejection; never reports CTF payouts or infers INVALID. |
| `finalizeMarket(questionId)` | Anyone. Requires acceptance and independently verified settled UMA state; reports the stored outcome once to the exact CTF condition. |

Existing CTF preparation is permissionless. If someone has already prepared the exact bridge/question/two-slot tuple, creation reuses it after validation; that caller does not become the oracle. A condition ID must also equal the official packed hash of bridge, question ID, and uint256(2).

Rules have no update function. The owner can create markets and transfer/renounce ownership but cannot replace a market's outcome, deadline, provider, or payout rules. Renouncing ownership prevents future creation. Text validation cannot establish clear or truthful evidence; the creator must still write precise rules.

## Bonds, refunds, and rejected assertions

Before proposing, the user approves the bridge for the reviewed amount of bond tokens. The bridge checks current whitelists, calls `syncUmaParams`, then computes the required bond. This explicitly refreshes the provider cache and can change the minimum; the immutable 400-token floor still applies if the minimum falls to zero. The entire transaction, including sync, reverts if the spend cap fails.

The bridge transfers exactly the required amount from the proposer, checks its balance increase, approves OOv3 for that exact amount, and calls `assertTruth` with the proposer as beneficiary. It clears approval and verifies its balance returned to the starting value. Fee-on-transfer funding is rejected. Existing donated token balances are not spent. No general recovery function is included, so unsolicited donations can remain stranded.

UMA, not the bridge, escrows the bond. Returned funds go directly to the designated proposer or disputer under provider settlement rules. A direct challenger approves OOv3 separately for the recorded assertion bond. MOCK position collateral stays entirely in the existing CTF/LocalCTFAdapter flow.

Each assertion stores its question, outcome, proposer, bond, claim hash, and status. The bridge checks the provider record's caller, recipient, currency, identifier, bond, timing, and escalation policy. Reused/zero assertion IDs are rejected atomically. Only one active assertion is allowed per market.

## Callback lifecycle and finalization

State flow:

```text
no active assertion -> Pending -> Disputed (optional)
                           \          /
                        Accepted or Rejected
Accepted -> independent verification -> CTF finalization
Rejected -> independent verification -> a new assertion attempt
```

Callbacks authenticate OOv3 and reject unknown IDs. Matching repeated terminal notifications are no-ops; a contradictory terminal result reverts. Repeated/late dispute notifications cannot undo accepted/rejected state. Notifications for a rejected old attempt cannot clear a newer active assertion. Tests exercise these sequences explicitly.

Callbacks have no external calls. They must be callable during UMA settlement, so they are not wrapped in a guard that would block a legitimate nested notification. Entry points that create markets, fund assertions, or finalize are nonReentrant. The bridge exposes no settlement wrapper; anyone can request settlement directly from the provider.

A false callback only marks that proposal rejected. Before funding a replacement, the bridge checks UMA actually settled it false. Before CTF finalization, it checks UMA actually settled the accepted assertion true with the expected configuration. An authenticated but inconsistent callback cannot by itself authorize a payout.

Final payouts are YES `[1,0]`, NO `[0,1]`, and INVALID `[1,1]`. INVALID requires a positively accepted proposal under the stored explicit criteria. Rejection, elapsed time, a failed callback, or an unresolved dispute never resolves the condition. A resolved callback does not call CTF.

`finalizeMarket` sets its marker before the external CTF call, then checks the denominator and both numerators. A revert rolls back the marker so reporting can be retried. After success, duplicate finalization is rejected. Separate YES and NO holders redeem through the unchanged LocalCTFAdapter; INVALID pays half per position, with integer rounding, not a refund of acquisition price.

## Test evidence

The new suite has **26 tests**. It covers configuration/market validation, provider eligibility changes, exact approvals and bond accounting, insufficient funding, fee-on-transfer rejection, donated balances, spend caps after cache sync, authorization, unknown/duplicate/stale callbacks, malformed provider records, cross-market isolation, rejected retries, disputed pending states, all payouts, token reentry, callback rollback, finalization retries, and three complete CTF split/redemption lifecycles.

The official CTF package is used in normal bridge and lifecycle tests. `TestRetryCTF` is used only for deliberately broken finalization tests. `TestUmaOracle` models selected provider behavior with a manually controlled arbitration result and simplified fee custody. It is not real UMA, an economic simulation, or proof of DVM compatibility. `TestRevertingUmaRecipient` demonstrates callback-failure rollback in that model. A pinned real-provider integration/fork suite remains a review requirement before deployment.

Commands run:

```powershell
npm.cmd run compile
npx.cmd hardhat test test/UmaCTFOracleBridge.ts test/QuestionRegistry.ts test/QuestionReader.ts test/ctf-adapter/LocalCTFAdapter.ts test/ctf-integration/CompleteCTFLifecycle.ts --no-compile
npm.cmd test -- --no-compile
git diff --check
```

Actual results: compilation passed; focused bridge plus security/integration suites **65 passed** (26 new and 39 existing); full suite **190 passed**; diff check passed. The final source was compiled again after a readability-only cleanup and the full suite rerun. Compilation used approved global-cache access outside the sandbox because of the previously diagnosed cache permissions.

I also ran `npx.cmd tsc --noEmit`. It failed because the repository's existing `module: "node20"` setting is unsupported by the installed TypeScript compiler, with accompanying module-resolution/type errors. I did not change shared configuration. Targeted checks without strict mode also failed to infer Viem clients; these were not reported as passes. The final targeted strict check passed:

```powershell
$artifactTypes = @(rg --files artifacts -g '*.d.ts')
npx.cmd tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2023 --skipLibCheck test/UmaCTFOracleBridge.ts hardhat.config.ts @artifactTypes
```

This targeted result does not mean the entire repository type-checks.

## Remaining security review and deployment gates

1. Independently review bridge state transitions, callback sequencing, claim format, dependency trust, bond synchronization, and error recovery. Passing tests are not a formal audit.
2. Verify the actual deployed OOv3 runtime/source against a pinned release. Interface provenance alone is insufficient. Test real provider behavior locally with pinned artifacts or an explicitly separate fork setup.
3. Treat Sepolia dispute completion as unverified; the earlier report's VotingV2 route does not establish live production DVM arbitration. Pending disputes can lock an assertion indefinitely. No administrative override is included.
4. Bond tokens and provider governance remain trusted. The exact transfer checks do not make arbitrary rebasing/malicious tokens safe. Whitelist/provider changes can block new assertions. Provider dishonesty or a forged provider result is outside what this bridge can cryptographically prove.
5. The administrator's market wording/evidence policy can be ambiguous or biased. The initial two-hour/400-token settings are learning defaults, not a production security budget. Fund the separate test USDC bonds only after deployment and transaction approval.
6. This bridge does not enforce trading deadlines on CTF positions, implement a dispute UI/monitor, upgrade existing conditions, or synchronize QuestionRegistry. Existing conditions and scripts remain unchanged. A future deployment requires a new approved condition and independently guarded commands.
7. Fix the repository-wide TypeScript configuration in a separate authorized change before treating all developer checks as green.

The next step is the separate bridge security review, not deployment. No deployment command was added for this contract.
