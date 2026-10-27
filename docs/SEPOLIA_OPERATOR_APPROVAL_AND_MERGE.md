# Sepolia ERC-1155 operator approval and binary merge

This note covers two separate steps after splitting 1 MOCK into YES and NO outcome positions. Operator approval and merging are different transactions. Approving the adapter does **not** merge positions.

## Saved condition and deployed contracts

- Network: Ethereum Sepolia, chain ID `11155111`
- ConditionalTokens: `0x0CF01081fa2843BD187AC1A52C5a32C02211ee36`
- MockCollateral: `0x43F1917aa363882f288E67C5Db118E44B69FD8E1`
- LocalCTFAdapter: `0x8cCB16d29a5F2e94375fCE5072C464f65370dFF0`
- Wallet and oracle: `0x8cfbcfc0e1c974970f03627e820ded0c95a7b6fa`
- Saved Question ID: `0x73ab19f7f6dbc9776a16fb868152cc24c8a8bb377e5e8af87a96f29c54bf60be`
- Saved Condition ID: `0xededc961c06f120960547f392e1623a6ba2d46a68badafc28ee81f99b45b4cec`
- Quantity: `1000000000000000000` base units (1 MOCK and 1 unit of each outcome position)

Both commands reuse the saved record. They do not create a new question or condition. They verify the live CTF status rather than trusting the cached status fields in that record.

## Step 1: Check or grant operator approval

First run the read-only preflight:

```powershell
npm.cmd run approve:sepolia:ctf-operator
```

It verifies Sepolia, CTF/collateral/adapter code against local artifacts, adapter CTF/collateral configuration, the original condition's identity and prepared/unresolved status, the wallet's YES and NO balances, and `isApprovedForAll(wallet, adapter)`. If approval is not already enabled, it simulates exactly `ConditionalTokens.setApprovalForAll(adapter, true)` and estimates gas. It prints the operator, wallet, addresses, positions, balances, and estimate, then exits without a transaction.

If I decide to grant this permission, I run the same command with `--submit`:

```powershell
npm.cmd run approve:sepolia:ctf-operator -- --submit
```

After repeating and displaying the checks, it asks me to type exactly:

```text
I_APPROVE_CTF_OPERATOR_FOR_ADAPTER_ON_SEPOLIA
```

Only after that phrase does it load `SEPOLIA_PRIVATE_KEY` from `.env`, verify that its address matches the expected wallet, and submit the one `setApprovalForAll(adapter, true)` transaction. It waits for two confirmations and verifies `isApprovedForAll(wallet, adapter)` is true. It prints the transaction hash and Sepolia Etherscan link.

This is a broad ERC-1155 permission: while enabled, the adapter can transfer the wallet's ConditionalTokens positions. The guarded merge command uses it to pull the selected YES/NO pair. I should revoke it separately after learning/testing if I no longer want that permission; this approval command does not revoke it.

## Step 2: Review the separate merge preflight

After the operator approval is enabled, run:

```powershell
npm.cmd run merge:sepolia:mock-collateral
```

This does not send a merge. It rechecks the same contracts and original condition, verifies operator approval is true and the wallet owns at least 1 YES and 1 NO position, simulates `LocalCTFAdapter.mergeBinary(oracle, questionId, 1000000000000000000)`, estimates gas, and displays the addresses, IDs, position balances, MOCK balance, and gas estimate.

## Step 3: Submit a merge only if I choose

The merge has its own independent confirmation and transaction command:

```powershell
npm.cmd run merge:sepolia:mock-collateral -- --submit
```

After fresh checks are displayed, I must type exactly:

```text
I_CONFIRM_MERGE_1_MOCK_ON_SEPOLIA
```

Only then does this separate command load the key, confirm the signer address, recheck the live condition/approvals/balances, simulate again, and submit only `mergeBinary`. It waits for two confirmations and checks that YES decreased by exactly 1, NO decreased by exactly 1, and MOCK increased by exactly 1. The transaction hash and Sepolia Etherscan link are reported. The program does not merge automatically after operator approval.

## Safety and tests

Neither command prints the private key or RPC URL. Running without `--submit` never loads the private key or creates a wallet client. There are no condition-preparation, split, payout-reporting, or redemption writes in either command.

The tests use mock readers and mock sender callbacks. They verify validation, simulation, confirmation ordering, receipt handling, and balance/approval checks; they do not broadcast Sepolia transactions.

```powershell
npx.cmd tsx --test test/scripts/SepoliaOperatorApproval.ts test/scripts/SepoliaBinaryMerge.ts
npm.cmd test -- --no-compile
```
