# My UMA provider verification

Date: 2026-10-28. The UMA bridge architecture is approved for learning/testnet development. Implementation still needs approval. INVALID is allowed only when defined in immutable rules and supported by a finalized accepted assertion. No timeout, failed callback, or rejected assertion may produce INVALID automatically.

## What I actually checked

I used the project's existing `loadRpcUrl` helper and Viem public client from an inline Node/tsx command. I did not initialize a wallet client or load a signing account. The first sandboxed chain-ID read failed with `HttpRequestError -> TypeError -> AggregateError (EACCES)`. The same endpoint worked outside the sandbox with approved read-only execution. No credentials were printed.

The successful requests were `eth_chainId`, `eth_getBlockByNumber`, `eth_getCode`, and `eth_call`. Contract reads used a single fixed block:

- Chain: Ethereum Sepolia, **11155111**.
- Block: **12008422**.
- Block timestamp: **2026-10-27 23:28:24 UTC**.
- Block hash: `0xcb80300dbb4d22aead8193edc27b65a59e554e78d2097a43f984ae7315d0377f`.

This is a point-in-time snapshot from one configured RPC, not independent multi-provider consensus or a guarantee of future values.

## Verified configuration snapshot

| Item | Result |
| --- | --- |
| OOv3 official published address | `0xFd9e2642a170aDD10F53Ee14a93FcF2F31924944` |
| Code at that address | 17837 bytes |
| Runtime keccak256 | `0xb09ecb16112fd9cb2eccf24f64bcb491645cf45f2b817aabfd1f47a8aea71425` |
| `defaultCurrency()` | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Currency metadata | USDC / USDC, 6 decimals |
| Currency whitelist / OOv3 cached whitelist | Both true |
| `getMinimumBond(defaultCurrency)` | **400000000 base units = 400 test USDC** |
| `defaultLiveness()` | **7200 seconds = 2 hours** |
| `defaultIdentifier()` | `ASSERT_TRUTH`; IdentifierWhitelist confirms supported |
| `burnedBondPercentage()` | 500000000000000000, equivalent to 50% |
| OOv3 cached final fee | 200000000 base units = 200 test USDC |
| Store `computeFinalFee(currency)` | **0 base units** |
| Existing MOCK whitelist status | **false** |
| Known test wallet USDC balance | **0 base units** |

The known public wallet checked was `0x8cfbcfc0e1c974970f03627e820ded0c95a7b6fa`. I did not inspect its private key or change its allowances.

The OOv3 address matches the [official UMA Sepolia manifest](https://github.com/UMAprotocol/protocol/blob/master/packages/core/networks/11155111.json). The token address matches [Circle's official Ethereum Sepolia USDC listing](https://developers.circle.com/stablecoins/usdc-contract-addresses). Its units must not be confused with the 18-decimal MOCK used for prediction collateral.

Code presence, public getter results, and matching published addresses support compatibility, but are not a full reproducible bytecode/source comparison. Etherscan source retrieval returned HTTP 403 during research. The exact deployed build/commit remains to be independently pinned and matched before deployment approval.

## Cached bond data differs from the Store

At the same block, OOv3's cached fee was 200 USDC while the Store fee was zero. The actual minimum getter returned 400 USDC. The reviewed implementation calculates the minimum using its cached fee and burn percentage; `syncUmaParams` can refresh cached values. I did not call it. [Official implementation](https://github.com/UMAprotocol/protocol/blob/master/packages/core/contracts/optimistic-oracle-v3/implementation/OptimisticOracleV3.sol)

Therefore 400 is the observed current requirement, not an immutable protocol constant. A later parameter sync could change it. This mismatch does not establish why the Store configuration changed, and it does not justify sending a zero-bond assertion.

Proposed bridge policy: freeze a nonzero market bond floor and compute `max(marketBondFloor, currentMinimumBond)` at assertion time. Require a proposer-supplied maximum spend to reject unexpected increases. Record the actual bond for each assertion. For the first Sepolia lesson, a 400-test-USDC floor is a proposal for approval, not a production economic-security recommendation. Do not silently reduce the floor if the provider minimum falls to zero.

## Dispute routing and DVM limits

| Read | Address |
| --- | --- |
| OOv3 `finder()` | `0xf4C48eDAd256326086AEfbd1A53e1896815F8f13` |
| OOv3 `cachedOracle()` | `0xd6Fc66498aE366892BDa974Fd4eF903Ca7202F76` |
| Finder `Oracle` | Same `0xd6Fc...2F76` address |
| Finder `CollateralWhitelist` | `0xE8DE4bcE27f6214dcE18D8a7629f233C66A97B84` |
| Finder `IdentifierWhitelist` | `0xfcb6f77112951e1995d37542b519Fe0a85a1AA77` |
| Finder `Store` | `0x39e7FFA77A4ac4D34021C6BbE4C8778d47F684F2` |

The official manifest labels the current Oracle address **VotingV2**, not MockOracleAncillary. Its code is present (22612 bytes), with hash `0xc83945406d6048601d167d5de7ce8f6c744aae89b1921c957ecb561fbd553336`. Do not assume the mere presence of a MockOracleAncillary entry in the manifest means OOv3 currently uses it.

UMA's current network table marks Sepolia as unmonitored, permissionless settlement supported, and **DVM support: No**. A configured testnet VotingV2 route does not prove active voters, quorum, bounded settlement time, or a connection to production mainnet DVM arbitration. Those are unverified; no disputed assertion was submitted. [Official network information](https://docs.uma.xyz/resources/network-addresses)

Plan: use deterministic local dispute fixtures and separately test official UMA behavior through a pinned artifact/fork. Do not promise live Sepolia dispute completion. A stalled dispute leaves the market unresolved, with no timeout payout or administrator override.

## Callback and settlement behavior

The verified official callback names are:

```text
assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully)
assertionDisputedCallback(bytes32 assertionId)
```

The boolean concerns the truth of the stored proposal, not the YES position. Authenticate OOv3 and match a known assertion/market/attempt. [Official callback interface](https://github.com/UMAprotocol/protocol/blob/master/packages/core/contracts/optimistic-oracle-v3/interfaces/OptimisticOracleV3CallbackRecipientInterface.sol)

Use configurable `assertTruth`, supplying the bridge as callback recipient, explicit liveness, supported bond currency, bond and identifier. Set escalation manager and optional UMA domain ID to zero initially; domain-separate the market/claim independently. `assertTruthWithDefaults` does not enable callbacks. The interface requires recipients not to revert during legitimate callbacks. [Official OOv3 interface](https://github.com/UMAprotocol/protocol/blob/master/packages/core/contracts/optimistic-oracle-v3/interfaces/OptimisticOracleV3Interface.sol)

Undisputed assertions can settle after expiry. Disputed settlement waits for an oracle result. Settlement transfers bonds and invokes callbacks in one transaction; a reverting callback rolls it back. A failed dispute callback similarly reverts that dispute transaction, so a broken hook can prevent challenges. `getAssertionResult` is not a generic pending-status boolean; with the proposed default escalation policy, use settled status before reading it. [Official implementation](https://github.com/UMAprotocol/protocol/blob/master/packages/core/contracts/optimistic-oracle-v3/implementation/OptimisticOracleV3.sol)

Bridge design implications:

- Both legitimate callback paths must stay simple and predictable: update bounded local state and emit events, without CTF, registry, token, or provider calls.
- False means this proposal failed. Preserve its history, reopen only after finalized rejection, and permit a fresh assertion. Never invert the proposed outcome automatically.
- A dispute notification alone must not clear the active assertion or permit a competing one.
- Separate provider settlement from CTF finalization. Anyone can trigger finalization only after the stored assertion is accepted and provider state agrees. A CTF revert must leave finalization retryable.
- Avoid a bridge guard arrangement that blocks UMA's legitimate nested callback during a settlement wrapper. Prefer direct external provider settlement and separate bridge finalization.
- Pin escalation policy to avoid alternative callback sequences until explicitly implemented/tested.

## Funding and approvals

Prediction collateral stays MOCK. Assertion/dispute bonds use the verified test USDC currency. These funds and allowances are separate.

For a proposed assertion: the user approves the **bridge** for the reviewed bond amount; the bridge pulls it, approves **OOv3** for that amount, calls `assertTruth`, and clears residual approval. The assertion beneficiary is the actual proposer, so returned bonds do not become stranded in the bridge.

For a direct dispute: the challenger approves **OOv3**, then posts the assertion's recorded bond. A challenger needs its own bond plus Sepolia gas. At a 400-USDC assertion bond, proposer and challenger each need 400 test USDC to exercise a dispute. UMA documents equal proposer/disputer bonds and bond allocation on settlement. [Bond and liveness guide](https://docs.uma.xyz/developers/setting-custom-bond-and-liveness-parameters)

The checked wallet has zero bond tokens. [Circle's faucet](https://faucet.circle.com/) lists Ethereum Sepolia and currently documents 20 test USDC per address/network every two hours. One grant is insufficient for the observed bond. Obtain test tokens through supported channels or remain local; do not bypass limits, purchase real assets, lower provider safeguards, or treat MOCK as eligible. No faucet request or approval was made here.

## Approved payout mapping

| Final accepted proposal | CTF payout vector |
| --- | --- |
| YES | `[1,0]` |
| NO | `[0,1]` |
| INVALID, explicitly defined in immutable rules | `[1,1]` |
| Rejected, disputed/pending, timeout, or failed callback | **No payout report** |

The new bridge must be the oracle in `prepareCondition(bridge, questionId, 2)` and the caller of `reportPayouts(questionId, payouts)`. Keep exact IDs. INVALID pays half per position, subject to integer rounding; it is not a refund of a trader's purchase price. The existing resolved condition is excluded from Stage 5 creation and reporting commands.

## Deployment settings versus market state

| Lifetime | Values |
| --- | --- |
| Immutable deployment configuration | Expected chain 11155111; verified CTF and OOv3 addresses; permitted bond-token address; creator/admin policy; fixed no-escalation-manager policy; bounds for allowed liveness; no arbitrary payout override |
| Immutable per-market rules | Question/rules text commitment and durable evidence location; rules version; resolution deadline; evidence precedence/correction rules; explicit INVALID criteria; payout mapping; nonce/question ID/condition ID; oracle bridge; identifier; chosen liveness; nonzero bond floor |
| Per-assertion snapshot | Assertion ID, market ID, attempt, proposed outcome, claim hash, proposer/beneficiary, actual currency/bond, assertion/expiration times, active/disputed/rejected/accepted status |
| Recheck before each assertion | Chain and code/configuration; current currency/identifier support; current minimum bond; balances/allowances; provider routing/cache changes; whether another assertion exists |
| Finalization state | Accepted assertion/outcome and once-only CTF reporting status |

Use 7200 seconds explicitly for the first market if approved; do not inherit mutable defaults invisibly. Two hours is an observed default, not proof of sufficient challenge time. Changing market rules after positions exist must not be allowed.

## Remaining unknowns and implementation plan

Remaining unknowns: reproducible deployed-source match; a pinned UMA revision/artifact compatible with the local build; why Store and cached fees differ; active Sepolia dispute voting/service guarantees; and sufficient bond funding. The wallet's existing MOCK allowance says nothing about USDC funding or approval. No assertion was simulated or submitted because no bridge/approved claim exists yet.

1. Approve this report's explicit 7200-second learning liveness, proposed 400-USDC market floor, pending-dispute limitation, and separate bond funding. Supply one precise market/evidence specification including INVALID criteria.
2. Pin provider interface/source revision and reproduce or independently verify deployed provenance. Keep Solidity 0.8.34 bridge and legacy 0.5.10 CTF separate; avoid importing the full exact-0.8.16 UMA dependency graph without an approved isolated build plan.
3. Implement the bridge only after approval. Keep QuestionRegistry, QuestionReader, LocalCTFAdapter, existing IDs, and scripts unchanged; add separate market records/commands later.
4. Add local tests for unauthorized/unknown/replayed callbacks, deadline boundaries, concurrent assertions, rejected-then-retried claims, all three accepted payouts, disputed/pending states, reverting callbacks and retry, bond-floor/minimum changes (including the observed cache mismatch), token units, allowance cleanup, reentrancy, finalization rollback, and double redemption.
5. Run mocked-provider tests separately from official-provider integration/fork tests. Preserve the 164-test baseline; compile and run full tests when implementation exists. Review the bridge's security before any deployment proposal.
6. Recheck live configuration and funding just before any separately approved Sepolia deployment/assertion. Start with an undisputed lifecycle; do not claim production DVM testing from that result.

Only documentation changed in this task. `git diff --check` passed. No compilation/test run was needed for documentation-only changes; 164 passing remains the previous verified result. No signing, broadcasts, conditions, approvals, or payouts occurred.
