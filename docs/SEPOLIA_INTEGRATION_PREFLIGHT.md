# Read-only Sepolia integration preflight

This command checks the already deployed Gnosis Conditional Token Framework project without preparing a condition or sending a transaction:

```powershell
npm.cmd run preflight:sepolia:integration
```

It uses a Viem public client with no wallet account. It does not read `SEPOLIA_PRIVATE_KEY`, create a wallet client, sign, deploy, approve tokens, prepare a condition, or report payouts. The script uses `SEPOLIA_RPC_URL` from the process environment when present; otherwise it reads only that setting from the local `.env` file. It does not print the RPC URL.

The fixed addresses checked are:

- Official CTF: `0x0CF01081fa2843BD187AC1A52C5a32C02211ee36`
- MockCollateral: `0x43F1917aa363882f288E67C5Db118E44B69FD8E1`
- LocalCTFAdapter: `0x8cCB16d29a5F2e94375fCE5072C464f65370dFF0`

The preflight verifies chain ID `11155111`, checks all three addresses have runtime code, and compares that code against the project's compiled artifacts. The adapter comparison ignores only compiler-recorded immutable byte ranges, then calls `ctf()` and `collateral()` and checks the configured addresses. A code or bytecode match does not independently establish source provenance; verify published source and deployment records separately.

## Optional inputs

All inputs are optional. Set them only for a wallet and condition you intend to inspect. These are public addresses/identifiers, not secrets.

```powershell
$env:PREFLIGHT_TEST_WALLET_ADDRESS = "0xYourTestWalletAddress"
$env:PREFLIGHT_ORACLE_ADDRESS = "0xYourChosenOracleAddress"
$env:PREFLIGHT_QUESTION_ID = "0x" + ("11" * 32)
npm.cmd run preflight:sepolia:integration
Remove-Item Env:PREFLIGHT_TEST_WALLET_ADDRESS -ErrorAction SilentlyContinue
Remove-Item Env:PREFLIGHT_ORACLE_ADDRESS -ErrorAction SilentlyContinue
Remove-Item Env:PREFLIGHT_QUESTION_ID -ErrorAction SilentlyContinue
```

With a test wallet address, it reads MockCollateral name, symbol, decimals, total supply, and that wallet's collateral balance. It also reads the wallet's ERC-20 allowance to the adapter and CTF ERC-1155 operator approval for the adapter; no oracle or question ID is needed for these approval reads. It reports the approval state; it never grants approval.

Condition inspection requires both oracle and question ID. The script calls the official CTF ABI to calculate the binary condition ID and read its outcome-slot count and payout denominator. It reports prepared when the outcome-slot count is two and resolved when the payout denominator is nonzero. It also checks that the adapter and official CTF derive the same condition ID and prints the YES/NO position IDs. With a wallet supplied, it reads that wallet's YES/NO balances.

Example using PowerShell with all optional inputs:

```powershell
$env:PREFLIGHT_TEST_WALLET_ADDRESS = "0xYourTestWalletAddress"
$env:PREFLIGHT_ORACLE_ADDRESS = "0xYourChosenOracleAddress"
$env:PREFLIGHT_QUESTION_ID = "0x" + ("11" * 32)
npm.cmd run preflight:sepolia:integration
```

The question ID must be exactly 32 bytes. The oracle and question ID must be supplied together. The wallet is not required for condition inspection. Do not put private keys or provider credentials in these optional variables.

## What this does not do

The preflight does not prove that an oracle is authorized for a not-yet-prepared condition. In CTF, the oracle address is part of the condition ID at preparation, and that same account must later call `reportPayouts`. The preflight only reads the condition derived from the supplied oracle and question ID.

It does not execute a live lifecycle. Preparing a condition, approving ERC-20 spending, splitting, granting ERC-1155 operator approval, merging, reporting payouts, and redeeming all require separate transactions. Review the printed state before any later transaction-based test.
