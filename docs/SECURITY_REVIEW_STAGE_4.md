# Stage 4 — My security review notes

This is a learning-project review, not a formal audit. I reviewed `QuestionRegistry`, `QuestionReader`, `LocalCTFAdapter`, and their local tests. I did not send transactions or query/change Sepolia during this review. The existing Sepolia condition is reported by the project owner as already resolved and redeemed; old unresolved-condition notes must not be used to describe its current state.

## What the contracts do

`QuestionRegistry` stores question text and outcomes. OpenZeppelin `Ownable` makes the deployer the administrator. The owner assigns a resolver to each question. Only that assigned address can resolve it, and an outcome cannot be changed after resolution. The owner can replace the resolver while a question remains unresolved.

`QuestionReader` is read-only. It stores a registry address and asks that registry for a question. Before this review, the constructor accepted zero addresses and ordinary accounts with no contract code; later reads would fail or decode incorrectly. I added checks that reject those two invalid constructor inputs. This does not prove that a code-bearing address is a genuine or trustworthy registry; deployments still need address verification.

`LocalCTFAdapter` is a narrow adapter for one collateral token and root binary CTF conditions. It uses OpenZeppelin `SafeERC20`, temporarily approves CTF for collateral during splitting, and uses `ReentrancyGuard` on split, merge, and redemption. Its ERC-1155 hooks reject single-token and unsolicited batches and accept only one expected CTF batch during the matching operation. The gate checks sender, operator, source, outcome IDs, amounts, and empty callback data, then consumes the expected callback. The operation clears its temporary state; a revert rolls back state and token changes atomically.

The adapter relies on the configured CTF and collateral contracts behaving as expected. `SafeERC20` handles common non-standard return-value behavior, but the adapter is not designed for fee-on-transfer or rebasing collateral. The deployed practice collateral is a standard test token; this is still a token-compatibility limitation for future deployments.

## Resolver and oracle trust

There are two separate resolver models in this workspace:

- `QuestionRegistry`: its owner selects and may replace a question's resolver until resolution. This protects against arbitrary public resolution, but puts resolver selection and replacement power in the owner's hands.
- Official Gnosis CTF: the oracle is fixed as part of the prepared condition identity. Only that oracle address can report its payout vector. Reporting is one-time and irreversible for that condition. `LocalCTFAdapter` cannot report outcomes on the oracle's behalf.

The CTF payout command checks the fixed saved condition, simulates the official `reportPayouts` ABI, and only enters its separate submit flow after explicit confirmation. The submit callback checks that the configured signer matches the condition oracle. Local integration tests cover unauthorized resolution, zero/wrong-length payouts, and the successful lifecycle. These checks do not establish that an oracle's real-world answer is honest or correct.

For a real market, the single-owner/single-oracle setup is a design limitation, not a confirmed code exploit. Consider a multisig or governed owner, an independently operated oracle, an explicit dispute/challenge process, and transparent outcome evidence. Those choices change the trust model, so I have not silently changed them in this learning contract.

## Confirmed issues addressed in this review

- `QuestionReader` previously accepted zero or no-code registry addresses. Its constructor now rejects both, with focused tests added.
- The registry tests were stale: they expected the question creator to resolve a question, while the current source uses owner-assigned resolvers. The tests now cover unassigned resolution, non-resolver rejection, owner-only resolver assignment/replacement, no zero resolver, and no reassignment after resolution.
- The top-level README said the workspace was local-only, claimed no deployment scripts, and reported 37 tests. It now records the Sepolia test deployments/lifecycle and scripts, and the latest 164 passing tests.

## Compiler lock diagnosis and successful verification

The earlier compilation attempts timed out after 60 seconds. The follow-up diagnosis established a filesystem permission problem in the Codex sandbox, not a stale lock. Hardhat 3.20.0 stores its mutex at `C:\Users\User\AppData\Local\hardhat-nodejs\Cache\compilers-v3\compiler-download-list`, outside the workspace's writable sandbox. No lock file was present when inspected. The only listed Node process was an Amazon Q language server; I did not terminate it.

Hardhat's installed mutex implementation retries `EPERM`/`EACCES` until its timeout. A one-second diagnostic using that same mutex and `DEBUG=hardhat:utils:synchronization` repeatedly logged `Failed to acquire lock, retrying due to permission error`. Running the unchanged standard compile with approved access outside the sandbox acquired and released the same mutex immediately and succeeded. This establishes the cause of the reproduced Codex failure; no lock deletion, process termination, compiler replacement, dependency upgrade, or configuration change was needed.

Both compiler versions were already cached. I also ran a forced build to verify them rather than relying on existing artifacts:

| Command | Actual result |
| --- | --- |
| `npm.cmd run compile` | Passed; rebuilt 2 files with Solidity 0.8.34 |
| `npm.cmd run compile -- --force` | Passed; 1 file with Solidity 0.5.10 (petersburg), 10 with Solidity 0.8.34 (osaka) |
| `npx.cmd hardhat test test/QuestionRegistry.ts test/QuestionReader.ts --no-compile` | 12 passed after the forced build |
| `npm.cmd test -- --no-compile` | 161 passed after the forced build |
| `git diff --check` | Passed |

The regenerated registry ABI includes `assignResolver`, `ResolverNotAssigned`, and `NotResolver`. The reader ABI includes both new constructor errors. The earlier 10 stale-artifact failures are cleared. Hardhat refreshed ignored build artifacts/cache and created/released its normal mutex; I did not manually alter compiler cache entries. Future Codex compilation needs permission to write the global cache, or can be run from the user's normal PowerShell terminal. Do not delete locks to work around this permission issue.

## Final Stage 4 verification — 2026-10-28

My verdict is **ready to close for learning/testnet use**, limited to the reviewed contracts, official pinned CTF, standard MOCK collateral, and explicitly trusted owner/oracle. This is not approval for real funds, a formal audit, or proof that no vulnerabilities exist. No new exploitable vulnerability was demonstrated in this final pass. No application contract, official CTF source, deployed address, or Sepolia condition was changed during final verification.

### What I checked and added

| Security area | Evidence and scope |
| --- | --- |
| Registry authorization | Existing tests reject unassigned and unauthorized resolution, non-owner assignments, zero resolvers, and changes after resolution. A new test confirms the replaced resolver loses authority and the owner cannot resolve directly unless assigned. The owner can still assign itself before resolution. |
| Reader validation | Tests reject zero/no-code registries and out-of-range question IDs. Its getters are read-only; code presence is not proof of a compatible registry. Registry direct out-of-range accesses revert with Solidity's bounds panic rather than a friendly custom error. |
| Reentrancy | All three adapter entry points use the same OpenZeppelin guard. A new test-only `contracts/test/AdapterReentrancyProbe.sol` receives actual CTF positions and attempts nested split, merge, and redeem calls. It requires the exact `ReentrancyGuardReentrantCall()` error for each attempt, then completes two normal split/merge cycles. This verifies the guard and reset on this callback path, not every possible hostile dependency. |
| Transfers and custody | Existing tests cover insufficient allowances/balances, missing operator approval, unsolicited ERC-1155 transfers, and atomic rollback. The new receiver test also checks the adapter-to-CTF ERC-20 allowance is zero after splitting and no collateral/positions remain in the adapter after merging. |
| CTF oracle and payouts | Official CTF derives the condition from the reporting caller, question ID, and payout-vector length. Existing tests reject an unauthorized oracle and zero/wrong-length payouts. A new real-CTF local test rejects a second report even from the authorized oracle and verifies the original payout remains unchanged. |
| Redemption | Existing official-CTF integration tests cover premature redemption rollback, winning and losing holders, forwarding collateral to the caller, burning positions, and rejection of a second redemption with no positions. |

The new receiver helper is unrestricted and deliberately adversarial. It exists only for local tests and must never be deployed or funded publicly. It does not replace the official CTF with a mock.

I ran these checks after adding the three regression tests:

```powershell
npm.cmd run compile
npx.cmd hardhat test test/QuestionRegistry.ts test/QuestionReader.ts test/ctf-adapter/LocalCTFAdapter.ts test/ctf-integration/CompleteCTFLifecycle.ts --no-compile
npm.cmd test -- --no-compile
git diff --check
```

Results: compilation passed (one new test-only Solidity 0.8.34 file); focused tests **39 passed**; full suite **164 passed**, zero failures; diff check passed. Both compiler versions had already passed the forced rebuild documented above. All new contract interactions ran on local ephemeral Hardhat networks. I did not query live Sepolia again; the resolved/redeemed status remains the user's supplied verified state.

### Limitations I accept for this learning exercise

- I trust the registry owner to assign and replace resolvers honestly. Ownership can be transferred or renounced; renouncing removes the ability to assign new resolvers, though existing assigned resolvers retain their authority.
- I trust the CTF oracle account to report correctly and remain available. A stolen key can report a false irreversible result; a lost/inactive key can leave unmatched positions unresolved indefinitely. Authorization alone cannot establish truth.
- There is no independent dispute or appeal mechanism. Resolving QuestionRegistry does not automatically report payouts to CTF; these remain separate systems.
- The adapter supports the pinned official CTF and standard MOCK collateral for root binary conditions. Fee-on-transfer and rebasing collateral are unsupported. SafeERC20 return-value handling does not make their accounting compatible.
- ERC-1155 operator approval is broad across the wallet's positions in this CTF contract. The current adapter pulls from its caller; users still need to understand the approval and can revoke it.

### Requirements before any real funds

These are production gates, not reasons to delay this limited educational milestone:

1. Define and independently review owner governance, key security, resolver replacement policy, oracle finality, outage handling, evidence, disputes, and any emergency response. Do not treat a personal test wallet as a production oracle.
2. Restrict deployments to independently verified collateral/CTF identities. Keep nonstandard collateral excluded unless its accounting is explicitly implemented and tested. Sending unrelated ERC-20 tokens directly to the adapter can strand them; there is no general recovery mechanism.
3. Expand adversarial tests: malicious ERC-20 callbacks/returns, malformed/missing/repeated expected CTF callbacks, receiver rejection rollback, and property tests for collateral conservation, fractional-payout rounding, and longer operation sequences. The new reentrancy probe covers outgoing CTF receiver callbacks during split; it does not claim all these paths are covered.
4. Obtain independent security review of the final integrated system, including the future oracle bridge and deployment configuration. Revalidate deployed runtime and constructor configuration separately; local source/tests alone do not re-attest deployed contracts.

### What I need to prepare for Stage 5

First write an oracle integration design: precise question wording, evidence source, deadline, YES/NO mapping, invalid or ambiguous outcomes, challenge period, finality, and unavailable-oracle behavior. Then compare oracle mechanisms and verify their current Sepolia support and trust assumptions before choosing one.

Design a separate authenticated oracle bridge that maps an oracle result to the exact CTF question/condition and calls `reportPayouts` only once after finality. Decide explicitly whether/how QuestionRegistry should be linked. Test wrong callers, replayed/duplicate responses, wrong question IDs, pending/disputed answers, and payout mapping locally before testnet deployment.

The existing resolved condition stays unchanged. Since the CTF oracle address is part of condition identity, a future bridge oracle requires a separately approved new condition for its integration tests. Closing Stage 4 does not authorize creating it or sending any transaction.
