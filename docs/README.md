# my learning notes

I wrote these notes while building the project. This is the order I use to
review what I learned:

1. [`SOLIDITY_EXPLAINED.md`](./SOLIDITY_EXPLAINED.md) — Solidity and the question registry
2. [`QUESTION_READER_REVIEW.md`](./QUESTION_READER_REVIEW.md) — interfaces and contract-to-contract reading
3. [`TOKEN_EXERCISE.md`](./TOKEN_EXERCISE.md) — ERC-20 and ERC-1155 basics
4. [`CTF_MOCK_EXERCISE.md`](./CTF_MOCK_EXERCISE.md) — split, merge, resolve, and redeem lifecycle
5. [`CTF_ID_EXERCISE.md`](./CTF_ID_EXERCISE.md) — condition, collection, and position identifiers
6. [`CTF_ADAPTER_EXERCISE.md`](./CTF_ADAPTER_EXERCISE.md) — local adapter tested against the actual CTF contract

7. [`LOCAL_CTF_ADAPTER_TESTING.md`](./LOCAL_CTF_ADAPTER_TESTING.md) - how I test the adapter lifecycle on Hardhat's local network
8. [`SEPOLIA_MOCK_COLLATERAL_APPROVAL.md`](./SEPOLIA_MOCK_COLLATERAL_APPROVAL.md) - how I check and, after a separate confirmation, approve exactly 1 MOCK for my Sepolia adapter
9. [`SEPOLIA_MOCK_COLLATERAL_SPLIT.md`](./SEPOLIA_MOCK_COLLATERAL_SPLIT.md) - how I check and, after a separate confirmation, split exactly 1 MOCK into YES and NO positions on Sepolia
10. [`SEPOLIA_OPERATOR_APPROVAL_AND_MERGE.md`](./SEPOLIA_OPERATOR_APPROVAL_AND_MERGE.md) - how I separately review and, if I choose, approve the adapter and merge 1 MOCK worth of positions on Sepolia
11. [`SEPOLIA_PAYOUT_AND_REDEMPTION.md`](./SEPOLIA_PAYOUT_AND_REDEMPTION.md) - how I inspect, report, and redeem the original Sepolia condition with separate safeguards

These are my local learning exercises. I do not treat the educational CTF files
as audited or production implementations of Gnosis CTF.
