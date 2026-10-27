# Sepolia MOCK approval for the adapter

This note explains how I prepare and, only if I choose, approve exactly **1 MOCK** for my deployed `LocalCTFAdapter`.

## What approval means

An ERC-20 approval gives one spender permission to transfer up to a chosen amount of a token from my wallet. Here, the spender is the adapter and the maximum amount is 1 MOCK. Approval does not move MOCK out of my wallet and does not split a condition.

The amount is exactly:

```text
1 MOCK = 1000000000000000000 base units
```

MOCK has 18 decimals. This ERC-20 approval is separate from ERC-1155 operator approval, which is not requested or changed by this command.

## Addresses used

- Network: Ethereum Sepolia, chain ID `11155111`
- Token: `MockCollateral` at `0x43F1917aa363882f288E67C5Db118E44B69FD8E1`
- Spender: `LocalCTFAdapter` at `0x8cCB16d29a5F2e94375fCE5072C464f65370dFF0`
- Expected wallet: `0x8cfbcfc0e1c974970f03627e820ded0c95a7b6fa`

The script checks the token and adapter runtime against local compiled artifacts. It also checks that the adapter's `collateral()` getter points to the expected MOCK token. These checks support compatibility with the artifacts; they are not a general audit or proof of source provenance.

## Step 1: Run the read-only preflight

From the project directory, run:

```powershell
npm.cmd run approve:sepolia:mock-collateral
```

The script uses `SEPOLIA_RPC_URL` from the terminal environment or `.env`. It checks the chain, contract code, token identity and decimals, adapter collateral address, expected wallet, MOCK balance, and current allowance. It then simulates the exact `approve(adapter, 1000000000000000000)` call and estimates its gas.

It prints the token, spender, amount, wallet, balance, current allowance, and gas estimate. With no `--submit` option, the command stops there. It does not load `SEPOLIA_PRIVATE_KEY`, create a wallet client, sign, or send a transaction.

Review those values before proceeding. The balance and allowance are fresh reads for that run; do not rely on an older preflight result. The wallet also needs Sepolia ETH to pay transaction gas if I later submit.

## Step 2: Request the approval transaction

Only if the readout is correct and I intend to approve exactly 1 MOCK, run:

```powershell
npm.cmd run approve:sepolia:mock-collateral -- --submit
```

This repeats the checks, prints the fresh values, and then prompts for this exact phrase:

```text
I_APPROVE_EXACTLY_1_MOCK_TO_ADAPTER_ON_SEPOLIA
```

I must type the phrase at the prompt after reviewing the output. If it is missing or differs, the command stops without submitting. Only after the exact phrase does the script load `SEPOLIA_PRIVATE_KEY` from `.env`, derive its address, and confirm it matches the expected wallet. The key and RPC URL are never printed.

The only transaction this command can submit is:

```text
MockCollateral.approve(LocalCTFAdapter, 1000000000000000000)
```

It waits for two confirmations, checks that the resulting allowance is at least 1 MOCK, and prints the transaction hash and Sepolia Etherscan link. If the receipt or later allowance check fails, it reports the hash when available. If the request fails before a hash is returned, its broadcast status may be unknown; check the wallet or explorer before retrying.

## What this command does not do

It does not prepare a condition, approve an ERC-1155 operator, split, merge, redeem, or report payouts. The saved binary condition is currently recorded as prepared but unresolved; this approval does not change that state. The live allowance should be checked again by the preflight immediately before the approval transaction.

The automated approval tests use mocked readers and a mocked sender. They verify the guards and flow, but they do not send a Sepolia transaction or prove live RPC behavior.

To run the focused safety tests and then the full local suite:

```powershell
npx.cmd tsx --test test/scripts/MockCollateralApproval.ts
npm.cmd test -- --no-compile
```
