# My Sepolia payout and redemption steps

These commands use the original saved binary condition. They do not create a question or prepare another condition.

The original question ID is `0x73ab19f7f6dbc9776a16fb868152cc24c8a8bb377e5e8af87a96f29c54bf60be`. Its saved record is in `test-records/ctf-conditions/`. The commands validate that record against the expected CTF, oracle, question ID, and condition ID before reading or writing.

## 1. Inspect current state (read only)

From the project directory, run:

```powershell
npm.cmd run preflight:sepolia:resolution
```

This uses only a public RPC client. It checks Sepolia chain ID, contract code against local artifacts, adapter CTF/collateral configuration, the official condition ID, binary preparation, payout denominator and numerators, YES/NO position IDs and balances, MOCK balance, and ERC-1155 operator approval. It does not load the private key or send a transaction. A bytecode match supports artifact compatibility; it does not prove source provenance.

## 2. Report payouts (irreversible)

Choose the actual outcome before running the command. The two numbers mean `[YES payout, NO payout]`; for example `[1,0]` means YES wins and `[0,1]` means NO wins. Those are examples, not a recommendation about the real-world outcome. The payout values are relative weights; CTF divides each by their sum.

First run a simulation and review the output. The CLI accepts either the readable labels `YES,NO` or numeric payout weights. For the selected YES test outcome, `YES,NO` means exactly `[1,0]`:

```powershell
npm.cmd run report:sepolia:payout -- --payouts YES,NO
```

For a NO outcome, use `--payouts NO,YES` (equivalent to `[0,1]`). Numeric forms such as `--payouts 1,0` also work. The program checks that the condition is unresolved, the authorized oracle is the intended signer, and the wallet still owns at least one YES and one NO position. This avoids resolving the condition before the wallet has positions available for redemption.

Reporting is irreversible for this condition. Only after deciding the outcome and reviewing the exact vector, run the separate submit mode:

```powershell
npm.cmd run report:sepolia:payout -- --payouts YES,NO --submit
```

At the prompt, type exactly:

```text
I_UNDERSTAND_PAYOUT_REPORTING_IS_IRREVERSIBLE_ON_SEPOLIA
```

The private key is loaded only after this confirmation and is never printed. The script also checks the signer is the authorized oracle, waits for two confirmations, then verifies the recorded denominator and both payout numerators. It prints the transaction hash and Sepolia Etherscan link.

## 3. Redeem positions (separate action)

After a successful payout report, first simulate redemption:

```powershell
npm.cmd run redeem:sepolia:positions
```

The adapter requires ERC-1155 operator approval. The command checks that approval, that the condition is resolved, that at least one held position has a non-zero payout, and that the adapter's redemption simulation agrees with a calculation from the CTF payout numerators. The adapter redeems all YES/NO balances held by the wallet for this condition, not just one token.

Only after reviewing the expected MOCK payout, request the separate transaction:

```powershell
npm.cmd run redeem:sepolia:positions -- --submit
```

At the prompt, type exactly:

```text
I_CONFIRM_REDEEM_ALL_ELIGIBLE_POSITIONS_ON_SEPOLIA
```

After two confirmations, the script checks both position balances are zero and the MOCK balance increased by the simulated payout. Keep the transaction hash if any post-transaction check reports a problem.

## Important current lifecycle note

The previous merge returned the YES and NO positions and gave MOCK back to the wallet. Therefore, before reporting payouts, the wallet needs positions again. While the condition is still unresolved, the already separate split command can split 1 MOCK back into YES and NO. That split is another on-chain operation and is intentionally not run by these payout or redemption commands. Review its read-only preflight and require its own confirmation. Do not report payouts until the wallet has positions to redeem.

Never share or commit the `.env` file, private key, seed phrase, or RPC credential. These commands are for a Sepolia learning exercise and are not production deployment tooling.
