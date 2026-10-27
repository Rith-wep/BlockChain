# Read-only binary CTF condition inspector

Run from the blockchain project directory in PowerShell:

```powershell
npm.cmd run ctf:inspect-condition -- "Will the described event occur by the stated deadline?"
```

Pass a specific question description after `--`. The script creates a local UUID nonce and calculates:

```text
keccak256(stringToHex(description + "|" + nonce))
```

It uses the configured `SEPOLIA_RPC_URL` (process environment first, then the local `.env` setting) and a Viem public client. The oracle is `0x8cfbcfc0e1c974970f03627e820ded0c95a7b6fa`; the CTF is `0x0CF01081fa2843BD187AC1A52C5a32C02211ee36`. It checks chain ID `11155111`, calls official CTF `getConditionId(oracle, questionId, 2)`, then reads `getOutcomeSlotCount(conditionId)` and `payoutDenominator(conditionId)`.

The script prints the description, nonce, question ID, oracle, condition ID, slot count, and whether the binary condition is prepared and resolved. A slot count of `2` means the condition is prepared as binary; a zero payout denominator means it is not resolved. It saves the generated values and the status snapshot under `test-records/ctf-conditions/<question-id-without-0x>.json`. The file is created exclusively; if a record already exists for that ID, the script stops without overwriting it.

This is read-only on-chain: it does not create a wallet client, read a private key, prepare a condition, approve collateral, split or merge positions, or report payouts. The local question ID and record can exist even when the corresponding on-chain condition is not prepared.

Run its local tests with:

```powershell
npx.cmd tsx --test test/scripts/ConditionInspector.ts
```
