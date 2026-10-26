# My MockCollateral Sepolia Deployment Report

## What I did

I deployed the `MockCollateral` practice token to Ethereum Sepolia. I did this
to have a test ERC-20 token for learning and CTF exercises. This token is not
real money, is not backed by anything, and is not suitable for production or
as real collateral.

## What this contract does

`MockCollateral` uses OpenZeppelin's ERC-20 implementation. When it is
deployed, its constructor:

- names the token **Mock Collateral**;
- sets its symbol to **MOCK**;
- uses 18 decimal places; and
- creates 100 tokens and gives all of them to the deploying wallet.

The token has no constructor arguments. Its initial supply is
`100000000000000000000` base units (100 tokens with 18 decimals).

## Deployment details

I have not copied the transaction details into this report yet. I should fill
these in from the deployment command output or Sepolia explorer. I should not
guess them.

| Item | Value |
| --- | --- |
| Network | Ethereum Sepolia (chain ID `11155111`) |
| Contract | `MockCollateral` |
| Deployer | Add the public wallet address shown by the deployment output |
| Transaction hash | Add the transaction hash shown by the deployment output |
| Contract address | Add the deployed contract address shown by the deployment output |
| Receipt status | Confirm `success` on Sepolia Etherscan |
| Token name / symbol | Confirm `Mock Collateral` / `MOCK` |
| Decimals | Confirm `18` |
| Total supply | Confirm `100` MOCK (`100000000000000000000` base units) |
| Initial recipient | Confirm the deployer received the full initial supply |
| Runtime bytecode | Confirm the deployment script reported an exact artifact match |

The project command for this deployment is:

```powershell
npm.cmd run deploy:sepolia:collateral
```

The deployment script is designed to check that it is connected to Sepolia,
require the deployment confirmation, check estimated cost and the balance
reserve before sending, wait for two confirmations, and verify deployed code
and token details afterward. These are the script's safeguards; the
transaction hash and address still need to be recorded here to complete the
deployment record.

## How I can verify it

1. Open the transaction hash on [Sepolia Etherscan](https://sepolia.etherscan.io/)
   and check that the receipt status is **Success**.
2. Open the contract address on Sepolia Etherscan and check that code exists
   at that address.
3. Confirm the contract address in the receipt matches the address printed by
   the deployment script.
4. Confirm the token's name, symbol, decimals, and total supply on the
   contract page or by reading the contract.
5. Confirm the deployer wallet's `MOCK` balance is 100 tokens, unless I have
   transferred some after deployment.
6. Compare deployed runtime bytecode with the project's compiled
   `MockCollateral` artifact. The script is designed to perform this check.

After I fill in the actual values, the explorer links will be:

- Transaction: `https://sepolia.etherscan.io/tx/<transaction-hash>`
- Contract: `https://sepolia.etherscan.io/address/<contract-address>`

## What this proves—and what it does not

A successful receipt means the deployment transaction completed. Matching
runtime bytecode and token reads give evidence that the expected practice
contract is at that address. This does not audit the token, prove it has
economic value, or make it suitable for real markets. Sepolia is a test
network, and `MOCK` is only an educational token.

I have not independently checked a transaction hash or contract address while
writing this report because those deployment identifiers were not included
with my request. I should add them and the verification results above before
treating this as a fully verified deployment record.
