# Split 1 MOCK on Sepolia

This is my next live CTF learning step: use the deployed adapter to turn exactly 1 MOCK into 1 YES position and 1 NO position for my already-prepared, unresolved binary condition.

## Fixed test setup

- Network: Ethereum Sepolia, chain ID `11155111`
- Official ConditionalTokens: `0x0CF01081fa2843BD187AC1A52C5a32C02211ee36`
- MockCollateral: `0x43F1917aa363882f288E67C5Db118E44B69FD8E1`
- LocalCTFAdapter: `0x8cCB16d29a5F2e94375fCE5072C464f65370dFF0`
- Wallet and condition oracle: `0x8cfbcfc0e1c974970f03627e820ded0c95a7b6fa`
- Question ID: `0x73ab19f7f6dbc9776a16fb868152cc24c8a8bb377e5e8af87a96f29c54bf60be`
- Condition ID: `0xededc961c06f120960547f392e1623a6ba2d46a68badafc28ee81f99b45b4cec`
- Split amount: `1 MOCK = 1000000000000000000` base units (18 decimals)

The command loads the saved condition record. It never generates another Question ID.

## First: read-only checks and simulation

From the project directory, run:

```powershell
npm.cmd run split:sepolia:mock-collateral
```

The command checks Sepolia chain ID, pinned runtime bytecode for CTF and MockCollateral, adapter runtime (allowing only compiler-recorded immutables), and the adapter's `ctf()` and `collateral()` addresses. It checks that the saved condition IDs agree with the official CTF, that the condition is prepared and unresolved, and that the wallet has at least 1 MOCK and at least 1 MOCK of allowance to the adapter.

It reads the wallet's current YES and NO position balances, simulates the exact adapter call, and estimates gas. It prints the addresses, IDs, amount, current balance/allowance, position IDs, and estimate. Without `--submit`, it stops without creating a wallet client, loading the private key, signing, or sending a transaction.

Simulation is a read-only check of whether the call currently appears valid. It does not reserve gas, guarantee a later transaction will succeed, or account for state changing before submission. The wallet also needs Sepolia ETH to pay gas.

## If I decide to submit

Only after reviewing the read-only output, I can start the interactive submission flow:

```powershell
npm.cmd run split:sepolia:mock-collateral -- --submit
```

That command repeats the live checks, prints the results again, then prompts me to type exactly:

```text
I_CONFIRM_SPLIT_EXACTLY_1_MOCK_ON_SEPOLIA
```

The script loads `SEPOLIA_PRIVATE_KEY` from `.env` only after this confirmation and verifies that its address is the expected wallet. It never prints the key or RPC URL. The only transaction it can submit is:

```text
LocalCTFAdapter.splitBinary(
  0x8cfbcfc0e1c974970f03627e820ded0c95a7b6fa,
  0x73ab19f7f6dbc9776a16fb868152cc24c8a8bb377e5e8af87a96f29c54bf60be,
  1000000000000000000
)
```

The command waits for two confirmations and verifies that the wallet's YES and NO balances each increased by at least 1 position token. It prints the transaction hash and Sepolia Etherscan link, including the hash if receipt or post-split verification fails after submission.

## What this command will not do

It does not prepare or resolve conditions, set ERC-1155 operator approval, merge positions, redeem positions, or report payouts. Splitting needs the ERC-20 allowance; it does not need the user to set ERC-1155 operator approval because the adapter forwards freshly minted positions to the wallet.

The automated tests use mocked public reads and a mocked sender. They test the guards, confirmation order, receipt handling, and position-balance verification, but they do not send a Sepolia transaction.

Run tests with:

```powershell
npx.cmd tsx --test test/scripts/SepoliaBinarySplit.ts
npm.cmd test -- --no-compile
```
