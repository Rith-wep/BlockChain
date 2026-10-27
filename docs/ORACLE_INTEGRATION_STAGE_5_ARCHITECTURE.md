# My Stage 5 oracle integration proposal

Research date: 2026-10-28. Update: the UMA bridge architecture is approved for learning/testnet development. INVALID is conditionally approved only under immutable rules and a finalized accepted assertion, never as a timeout/failure fallback. Bridge implementation awaits approval after [provider verification](./UMA_PROVIDER_VERIFICATION_STAGE_5.md). The sections below preserve the initial research; that report supersedes its unknown live settings and records the current VotingV2 route, bond currency, minimum, and cache discrepancy. No implementation or change to the resolved Sepolia condition was performed. The previous local verification remains 164 passing tests.

## Where my project is now

I inspected QuestionRegistry, QuestionReader, LocalCTFAdapter, the official installed CTF source, the preparation and payout scripts/helpers, Hardhat configuration, and the Stage 4 review. Existing uncommitted changes were preserved.

QuestionRegistry stores a question and boolean result. Its owner assigns the resolver. QuestionReader only reads that registry. LocalCTFAdapter manages collateral and binary positions; it neither chooses outcomes nor reports payouts. Its split, merge, and redemption methods receive an oracle address and question ID.

My existing condition uses my wallet as the CTF oracle. The payout script accepts a manually selected payout vector and checks that the signer is that oracle. It does not retrieve independently established evidence. The script's requirement to hold one YES and NO position is an exercise safeguard, not a CTF oracle requirement. An external oracle bridge should not need to own positions to resolve a market.

The original condition is already resolved and redeemed according to my verified project history. It cannot be reassigned to a new oracle or reported again. New integration tests need a separately approved new condition. No new question ID has been generated during this research.

## Provider comparison and evidence

These are documentation checks, not live RPC attestations. Official repository branches can change; a release/commit and deployed runtime must be pinned and verified before implementation or testnet use.

| Approach | What it provides | Sepolia evidence | Fit and limitations |
| --- | --- | --- | --- |
| UMA Optimistic Oracle v3 | Bonded outcome assertions with a challenge period | Official network table lists Ethereum Sepolia, chain 11155111, but explicitly lists no DVM support | My preferred learning route for general prediction questions. Requires monitoring, a supported bond currency, settlement transactions, and careful handling of disputed claims. |
| Chainlink Data Feeds | On-chain observations for supported feeds | Official guide provides a Sepolia BTC/USD example | Simplest alternative for a narrowly defined price question. Must specify the exact feed, round/time rule, decimals, and freshness; it is not an oracle for arbitrary event descriptions. |
| Chainlink CRE | Workflows that retrieve data and deliver reports | Official release notes discuss Sepolia on-chain writes; account-specific access and forwarder configuration remain unverified | Suitable for objective API-backed events. More workflow infrastructure, source-quality checks, and report authentication. No application dispute policy should be assumed. |
| Chainlink Functions | Older API computation service | Official docs mark testnet deprecated June 15, 2026 and mainnet June 30, 2026 | Do not start this project on the legacy Functions tutorial/router configuration. |
| Custom trusted resolver | A wallet, multisig, or service selects the answer | Ordinary EVM contract design; no external-provider deployment required | Easiest baseline but still trusts the operator. An automated API-reading bot with one signing key remains centralized. |

Sources: [UMA network table](https://docs.uma.xyz/resources/network-addresses), [Chainlink Data Feeds guide](https://docs.chain.link/data-feeds/using-data-feeds), [Chainlink release notes](https://docs.chain.link/changelog), [Functions deprecation notice](https://docs.chain.link/chainlink-functions/supported-networks).

UMA's official Sepolia deployment manifest lists OOv3 at `0xFd9e2642a170aDD10F53Ee14a93FcF2F31924944`. This is a documentation-derived candidate, not an address verified through my RPC today. The manifest also lists MockOracleAncillary; I have not established the deployed OOv3's current dispute routing. Sepolia must not be described as exercising production DVM voting. [Official manifest](https://github.com/UMAprotocol/protocol/blob/master/packages/core/networks/11155111.json)

UMA documents a sandbox using a mock dispute oracle for deterministic testing. I would use that only locally, clearly labeled, and never pretend a mock dispute result proves live decentralized arbitration. [Official sandbox guide](https://docs.uma.xyz/developers/optimistic-oracle-v3/sandboxed-oracle-environment)

Chainlink's CRE supported-networks and forwarder pages did not expose their tables through the research tool; the linked source page returned 404. The official release notes mention Sepolia writes, but a usable forwarder and this project's account access are still unverified. CRE workflow deployment requires organizational approval; local simulation is separately available. [CRE access requirements](https://docs.chain.link/cre/guides/operations/deploy-access), [network directory](https://docs.chain.link/cre/supported-networks).

## My recommendation

Use **UMA OOv3 through a separate CTF oracle bridge**, first locally and then for an explicitly approved undisputed Sepolia lifecycle. This best fits learning assertions, evidence, challenges, and finality for general prediction questions. UMA itself provides a prediction-market example, but that example uses its own outcome tokens: I would retain CTF ERC-1155 positions rather than copy its market architecture. [UMA example](https://docs.uma.xyz/developers/optimistic-oracle-v3/prediction-market)

This recommendation is conditional on verifying the published deployment, available bond token, identifier, minimum bond, liveness, and dispute routing. If a complete live decentralized dispute exercise is mandatory, Sepolia's documented lack of DVM support is a blocker. For a smaller price-only lesson, Chainlink Data Feeds is the alternative I would choose. I would not silently substitute an administrator's answer for an unavailable oracle result.

## Proposed contracts and boundaries

All names below are proposals, not existing functions or files.

| Component | Responsibility |
| --- | --- |
| `UmaCTFOracleBridge.sol` | Store immutable market rules and the mapping to CTF IDs; create assertions; authenticate UMA callbacks; record finalized outcomes; report once to CTF. It must not hold market collateral or outcome positions. |
| Pinned OOv3 ABI/interface | Describe only the official methods used. Keep provider address and configuration explicit and checked. |
| Local UMA test fixtures | Model callbacks, time, disputes, bonds, and failures; supplement with official OOv3 integration/fork tests. |
| Existing LocalCTFAdapter | Keep split/merge/redeem behavior unchanged. Use the bridge address as its oracle argument for new conditions. |
| Existing QuestionRegistry/QuestionReader | Keep unchanged as learning records, not authoritative CTF settlement state. |

Prefer one non-upgradeable bridge for the first exercise with immutable CTF/OOv3 addresses and no administrator payout override. Restrict creation of new markets to the learning administrator initially; allow anyone to submit a valid bonded assertion after the deadline and anyone to finalize an eligible result. Freeze rules, provider, payout mapping, bond policy, and liveness for each created market. A bounded pause may stop new markets/assertions but should not block finalized payouts or redemption.

Do not couple CTF reporting to a successful QuestionRegistry write. Registry ownership can replace the bridge as resolver, and its boolean outcome cannot represent an invalid/split result. If registry synchronization is later wanted, design it as a separate, retryable, non-authoritative operation with mismatch reporting. No registry modification is required for the first oracle exercise.

## IDs must match exactly

The installed official CTF computes:

```text
conditionId = keccak256(abi.encodePacked(address oracle, bytes32 questionId, uint256 outcomeSlotCount))
```

For this proposal, oracle is **the new bridge address**, not OOv3, the assertion proposer, my wallet, or LocalCTFAdapter. Prepare with `prepareCondition(bridgeAddress, questionId, 2)`. Compare the result with CTF's `getConditionId(bridgeAddress, questionId, 2)`.

The bridge later calls `reportPayouts(questionId, payouts)`. CTF uses the caller (`msg.sender`) and payout-array length to reconstruct the condition. Therefore a two-element array and the identical question ID are essential. Calling directly from a wallet or OOv3 would identify a different condition.

For new markets only, propose a domain-separated question ID derived from a version tag, chain ID, bridge address, local nonce, and immutable rules hash using typed `abi.encode`. This is our question-ID convention, distinct from CTF's packed condition hash. Persist the exact inputs. Existing question records keep their original encoding and IDs.

Store an explicit mapping from UMA assertion ID to market/question ID, proposed outcome, and attempt number. Never use an assertion ID as a substitute for a CTF question ID. A new bridge oracle changes the condition and its position IDs even if the question text is identical.

## Complete proposed lifecycle

1. **Define the market.** Specify a precise event, UTC deadline, evidence publisher/document, source precedence, correction cutoff, and treatment of cancellations or unavailable evidence. Commit the rules hash and publish the full content in events and a durable record. Human-readable rules must be accessible to challengers; a hash alone is insufficient evidence.
2. **Create and prepare.** The bridge registers the market and prepares a new binary CTF condition. Preparation itself is permissionless in CTF: if someone has already prepared the exact tuple, verify slot count and unresolved status and reuse it rather than assuming preparation grants oracle authority.
3. **Obtain positions.** The holder approves MOCK to LocalCTFAdapter and calls `splitBinary(bridgeAddress, questionId, amount)`. The adapter sends YES and NO positions to the holder. The bridge never spends this collateral.
4. **Wait for evidence.** Assertions are blocked before the committed resolution time. A transaction must trigger assertion; reaching a timestamp alone does not execute a contract. A future keeper can assist without gaining authority to choose the result.
5. **Assert an outcome.** The proposer selects YES, NO, or INVALID and supplies the required bond. The bridge constructs a claim binding rules, outcome, chain, bridge, CTF, and IDs. It calls OOv3's configurable `assertTruth` with itself as callback recipient and no custom escalation manager initially. Store one active assertion per market. Do not use a defaults helper that omits callbacks.
6. **Allow challenges.** Wait the verified liveness period. A dispute is not a final outcome. Do not start a competing assertion or report CTF payouts while the current assertion remains unsettled. Local tests model disputed settlement; public Sepolia disputed settlement needs separate routing verification and cannot be promised to complete.
7. **Record finality.** Authenticate the official OOv3 caller and the exact known assertion. A true assertion result accepts the stored proposed outcome. A false result rejects that proposal and permits a later attempt; it does not automatically mean NO. Pending or disputed is never a default loss.
8. **Finalize separately.** An authenticated resolution callback only records outcome/state and emits an event. A separate permissionless finalization transaction verifies official settlement state and calls CTF once. This avoids coupling provider callbacks to CTF/registry external-call failures. Use checks-effects-interactions and reentrancy protection; a failed CTF call must revert the finalization marker so it is retryable.
9. **Redeem.** Holders authorize LocalCTFAdapter as ERC-1155 operator and call `redeemBinary(bridgeAddress, questionId)`. Existing CTF/adapter accounting burns positions and forwards collateral. Bonds have separate accounting and never become prediction-market collateral.

Proposed payout policy, subject to approval: YES `[1,0]`, NO `[0,1]`, INVALID `[1,1]`. INVALID pays half per position and is not a refund of each trader's acquisition price. It must itself be supported by a finalized assertion under the committed rules. No timeout-to-INVALID fallback is proposed. If evidence or arbitration is unavailable, remain unresolved until the agreed mechanism can finalize; matching pairs can still be merged. This deliberate safety choice has a liveness risk.

The existing adapter/CTF does not enforce a market trading-close deadline. The bridge controls when outcomes may be asserted, not all position minting/transfers. An eventual trading venue needs its own timing rules; this lesson is settlement integration, not a complete exchange.

## Verified API and build considerations

The official OOv3 interface provides `assertTruth`, `getAssertion`, `getAssertionResult`, `getMinimumBond`, and `settleAssertion`. Its callback interface defines `assertionResolvedCallback(bytes32,bool)` and `assertionDisputedCallback(bytes32)`. The callback boolean describes truth of the assertion, not a YES/NO market label. [Official interface](https://github.com/UMAprotocol/protocol/blob/master/packages/core/contracts/optimistic-oracle-v3/interfaces/OptimisticOracleV3Interface.sol), [callback interface](https://github.com/UMAprotocol/protocol/blob/master/packages/core/contracts/optimistic-oracle-v3/interfaces/OptimisticOracleV3CallbackRecipientInterface.sol)

The reviewed OOv3 implementation uses exact Solidity 0.8.16; its interfaces use ^0.8.16. Our bridge can use 0.8.34 with an ABI-compatible interface while CTF remains a separate 0.5.10 build. Do not import the full UMA implementation into the current compiler/OZ dependency graph blindly. For genuine local provider integration, approve either a pinned artifact/fork or an isolated build with its original dependencies. UMA files carry AGPL-3.0-only notices; preserve licenses and review reuse before copying code. No dependencies or compiler versions were changed. [Official implementation](https://github.com/UMAprotocol/protocol/blob/master/packages/core/contracts/optimistic-oracle-v3/implementation/OptimisticOracleV3.sol)

UMA bonds require an approved currency; my MOCK token must not be assumed eligible. Check default/whitelisted currency and current minimum bond through a future read-only preflight. Pay bonds from a separate balance with scoped approvals; use the actual proposer as bond beneficiary. Verify the effective provider parameters instead of assuming a tutorial's liveness or bond values.

## Security design and test plan

| Risk | Required control and automated test |
| --- | --- |
| Forged callbacks | Only pinned OOv3 may call; reject random callers and unknown assertion IDs, including real OOv3 assertions created outside the bridge. |
| Replay or cross-market confusion | Bind each assertion once to its market/attempt/outcome. Test duplicate callbacks, stale attempt callbacks, two markets sharing text, and cross-chain domain inputs. Recognized duplicates must not overwrite state; callback handling must respect genuine provider sequencing. |
| Premature or disputed resolution | Test exact deadline/liveness boundaries, settlement before expiry, disputed-but-unsettled, and failure to obtain an arbitration result. |
| Incorrect payout mapping | Test accepted YES/NO/INVALID independently. A rejected assertion must not pay the opposite outcome. Test a rejected claim followed by a valid retry. |
| Callback deadlock/reentrancy | Keep callbacks local-state-only; do not place a guard around a provider settlement call that prevents its legitimate callback. Test callback ordering, malicious reentry, CTF reporting failure, and retry. |
| Mutable/ambiguous evidence | Rules immutable before positions are issued; test changed hash, missing evidence commitment, invalid outcome, and concurrent proposals. Runtime authentication cannot prove truthful evidence. |
| Bond abuse and starvation | Check supported token, minimum bond, exact transfers, beneficiary, allowance cleanup, and fee changes. Test multiple actors, insufficient balances, rejected proposals, and prolonged disputed state. Cheap false claims and absent challengers remain economic risks. |
| Finalization or redemption twice | Test replayed finalization, already-resolved CTF, no leftover custody, repeated redemption, and winner/loser/half-payout rounding. |
| Oracle governance compromise | Pin per-market provider policy, disallow arbitrary admin outcome override, and document upstream governance trust. A proxy/address check alone cannot guarantee immutable provider behavior. |

Test layers: deterministic local fixtures first; official CTF plus real pinned UMA artifact or read-only fork integration second; explicitly approved Sepolia smoke test last. Label locally mocked dispute results. Keep all 164 existing tests and add exact ABI/build compatibility checks. No new tests are claimed passing until implementation exists.

## Implementation phases and approval gates

1. Approve UMA OOv3, a separate immutable bridge, the INVALID policy, one active assertion at a time, and no administrative/timeout payout override. Supply one concrete event with precise evidence rules.
2. Read-only provider preflight: verify chain, code/source provenance, pinned ABI, Finder/dispute routing, supported identifier/currency, live bond and liveness, token accessibility, and Sepolia settlement limitations. Stop if unclear; do not substitute a mock provider silently.
3. After architecture approval, implement only the bridge/interfaces/local fixtures and tests. Preserve the existing resolved condition and all learning contracts.
4. Review the full diff, compile, run focused/full tests and static/type checks, and perform a separate bridge security review.
5. Only after explicit deployment approval: deploy/verify the bridge and prepare a new condition. Keep independent confirmation gates for assertions, disputes, settlement, CTF finalization, and redemption.

The existing scripts intentionally pin the old wallet and condition. Do not repoint them or reuse their saved record. Future Stage 5 commands need their own records and must accept the bridge oracle identity while preserving the current public-read-only preflight convention.

This proposal is ready for architecture review, not implementation or deployment approval. No claim of production readiness is made.
