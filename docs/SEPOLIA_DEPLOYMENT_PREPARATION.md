# My Sepolia deployment preparation

## Goal and current status

I want to learn how to prepare this project for Ethereum Sepolia. I approved local preparation using Viem scripts. The Sepolia configuration and guarded scripts are now in place; no contract has been deployed and no transaction has been sent.

Sepolia is an Ethereum test network for application development. It is not Mainnet, but testnet deployments are still public and permanent on that testnet. I will only use test ETH and a wallet made for testing. [Ethereum.org recommends Sepolia for application development](https://ethereum.org/developers/docs/networks/).

## What I found in my project

- The project currently has Hardhat `3.20.0`, `@nomicfoundation/hardhat-toolbox-viem` `5.0.7`, Solidity compiler settings for `0.8.34` and `0.5.10`, and `@gnosis.pm/conditional-tokens-contracts` `1.0.3`.
- `hardhat.config.ts` only configures the Viem toolbox and compilers. It has no Sepolia network, RPC URL, deployer account, deployment task, or explorer-verification setup.
- `package.json` only has `compile` and `test` scripts. There is no `scripts/` directory or Hardhat Ignition module. Existing tests create a local Hardhat network with `network.create()` and deploy contracts with Viem for testing; they are not deployment scripts.
- The project includes the official CTF package and compiles its `ConditionalTokens.sol` source locally. The official source uses Solidity `^0.5.1`, so this project uses the separate `0.5.10` compiler for that source and `0.8.34` for my own contracts. This preserves compiler compatibility without changing either version. The official source is in the [Gnosis CTF repository](https://github.com/gnosis/conditional-tokens-contracts/blob/master/contracts/ConditionalTokens.sol).
- The package listing in the official repository shows some historical deployment networks but does not list Sepolia. I found no CTF address in my project. I must not assume that a compatible CTF is already available on Sepolia; the address and deployed bytecode/source must be checked before I configure the adapter.
- I checked the official Gnosis repository and its published deployment list. It lists Mainnet, xDai, and Rinkeby, but not Sepolia. I could not verify an official CTF deployment on Sepolia from the authoritative project source. I will therefore leave `SEPOLIA_CTF_ADDRESS` empty and will not deploy the adapter until a trusted CTF address or a separately approved CTF deployment plan exists.
- `.gitignore` already ignores `.env` and `.env.*`, while explicitly allowing `.env.example`. I checked that `.env` and `.env.local` match the ignore rules. I did not find a local `.env` file during this inspection. An `.env.example` must contain placeholders only, never a real key or RPC credential.

## Contracts and addresses I need

| Contract | What it does | Sepolia action needed |
| --- | --- | --- |
| Official `ConditionalTokens` (CTF) | Holds collateral and creates, merges, and redeems ERC-1155 outcome positions. The adapter calls its CTF interface. | First find and verify a trusted CTF deployment for Sepolia. If none is suitable, deploying the official implementation is a separate decision that needs a reviewed deployment plan. Do not substitute `EducationalCTFMock`. |
| Collateral ERC-20 | The asset used to back positions and pay redemptions. | Choose an existing, verified Sepolia token and verify its address, code, decimals, and issuer/source. The local `MockCollateral` is for practice and should not be mistaken for a real collateral asset. |
| `LocalCTFAdapter` | Routes a user’s collateral and outcome positions through CTF. | Deploy after the CTF and collateral addresses are verified. Its constructor is `LocalCTFAdapter(address ctfAddress, address collateralAddress)`; it rejects zero addresses and addresses with no code. |
| `QuestionRegistry` | Stores questions and lets each creator resolve their own question. | Optional, separate practice deployment. It is not a dependency of `LocalCTFAdapter` or the official CTF. |
| `QuestionReader` | Reads from a previously deployed `QuestionRegistry`. | Optional. Deploy only after the registry and pass its address to the constructor. |
| `PracticeToken`, `PracticePositions`, `MockCollateral`, `EducationalCTFMock`, and the educational CTF ID harness | Learning-only contracts and examples. | Do not deploy these as production-market dependencies. In particular, the educational CTF mock is not Gnosis CTF. |

The official `ConditionalTokens` contract has no constructor arguments in its source (its ERC-1155 base constructor also takes no arguments). The local CTF source imports its own legacy ERC-1155 and helper code plus the package’s legacy OpenZeppelin dependency; these are compile-time source dependencies, not constructor addresses. The project’s `LocalCTFAdapter` only talks to the functions in `IConditionalTokens.sol` and stores the supplied CTF/collateral addresses.

The complete CTF deploy requirements visible in the source are: deploy the `ConditionalTokens` contract with no constructor arguments; use its bundled legacy ERC-1155 and `CTHelpers` source; compile its `^0.5.1` source with the configured compatible compiler `0.5.10`; and include the pinned compile-time `openzeppelin-solidity` `2.3.0` source dependency. `CTHelpers` functions are internal, so no separate library address is needed. Its collection-ID math calls the EVM `0x06` elliptic-curve addition precompile, so the target must support Ethereum's relevant EVM precompile. These requirements are understood, but I have not deployed or independently audited the official CTF package. The official source repository publishes no Sepolia deployment in its deployment list, so a new official CTF deployment still requires a separate approval and review.

For a binary market, I will also need to choose an oracle address and a unique `bytes32` question ID. The CTF condition is prepared for that oracle and question ID with two outcome slots. Only the same oracle address can report payouts because the official CTF derives the condition ID using the caller of `reportPayouts`. I must control the oracle account or have an explicit oracle process; deploying the adapter does not give it oracle authority.

## Sepolia configuration (prepared locally)

Hardhat 3 documents an HTTP network configuration with `chainType: "l1"`, URL/account configuration variables, and an optional chain ID. A later configuration change can follow this shape, adapting it to the installed Hardhat/TypeScript versions and validating it with a local compile before any network transaction: [Hardhat 3 network configuration](https://hardhat.org/docs/reference/configuration).

```ts
// now in hardhat.config.ts
sepolia: {
  type: "http",
  chainType: "l1",
  chainId: 11155111,
  url: configVariable("SEPOLIA_RPC_URL"),
  accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
}
```

The RPC URL and private key are read at run time with Hardhat configuration variables, not embedded in TypeScript. I created `.env.example` with placeholders only. `.env` is ignored by Git, but Node/Hardhat does not automatically load a file just because it exists; I need to set the variables in my shell (or use Hardhat's supported configuration-variable storage) before running a command. The adapter script validates address syntax, checks `eth_getCode` for both inputs, and requires a second explicit CTF-source/address confirmation. The code check alone only proves that code exists; it does not prove that a CTF address is official or safe.

`.env.example` documents variable names but does not load them. I can store the key in Hardhat's encrypted keystore and set the RPC URL in my shell, or use an ignored local environment file only after choosing a loader. I will not paste a real private key into source code or commit it.

If I use a local `.env` file, it must stay untracked and ignored. The existing project does not currently show a dotenv loader, so adding a `.env` file alone may not make its variables available to Hardhat. The later setup should either use Hardhat's supported configuration-variable mechanism or deliberately add and configure a suitable loader after approval. I should never put a deployer key, API credential, or real secret into `.env.example`, source files, terminal screenshots, or Git history. Hardhat 3 also offers an official encrypted keystore plugin for secrets; it is not currently installed. [Hardhat 3 lists its keystore and verification plugins](https://hardhat.org/docs/plugins/official-plugins).

## Compiler and dependency checks

The official CTF compiler is older than my application contracts. This is not automatically a blocker: the current config already selects the separate `0.5.10` compiler for the official package and `0.8.34` for my code. The deployment transaction uses compiled bytecode; the source compiler version does not need to match the runtime network. However, before a deployment script is created, I need to verify that the exact official CTF package source and exact build settings compile and that the deployed bytecode can be verified later with the same source, compiler version, optimizer settings, and constructor arguments.

Potential issues to resolve before deployment:

- Both compiler toolchains may need to be available locally. The old compiler and its legacy imports may cause download, lock, or build-environment problems even if the source configuration is correct.
- This project has not installed Hardhat Ignition or a deployment-specific script. Hardhat 3 has official deployment options, including Ignition and Viem support, but none are currently configured. We should choose one supported approach rather than copy a Hardhat 2 deployment tutorial into this Hardhat 3 project.
- The Hardhat Verify plugin is not installed/configured. Hardhat 3 documents an official verification plugin, but its compatible version and Sepolia explorer configuration need to be checked when we implement verification. The old CTF compiler and optimizer settings must be represented exactly for source verification.
- `LocalCTFAdapter` accepts any contract address with code; its constructor cannot prove that the address is the genuine CTF or the intended collateral token. Address verification is a deployment precondition, not something its current constructor guarantees.
- The CTF does not create collateral. The market flow needs a real Sepolia ERC-20 contract. A local mock is not automatically available on Sepolia, and any test token I deploy there must be clearly labeled as test-only.
- Sepolia test ETH pays transaction gas only; it is not collateral and has no Mainnet value. I must check faucet requirements and use only the public address of a dedicated test wallet.

## Test ETH and chain ID check

Ethereum.org currently lists multiple Sepolia faucet options. I should use a faucet linked from that page, submit only my Sepolia test wallet address, and never give a faucet my seed phrase or private key. Faucet limits and availability can change, so I will check the current faucet instructions at the time I need test ETH. [Current Sepolia faucet list](https://ethereum.org/developers/docs/networks/#sepolia).

Sepolia's chain ID is `11155111` (hex `0xaa36a7`). Before any transaction, I will query the configured RPC endpoint with `eth_chainId`, compare it with `0xaa36a7`, and stop if it differs. Hardhat's network configuration should also set `chainId: 11155111`, which gives an additional network mismatch check. I will separately inspect the deployer address and test-ETH balance before authorizing a deployment.

## Proposed deployment plan

1. **Keep the current local workflow intact.** Run the existing compile and tests before any network transaction so that any issue is separated from deployment work.
2. **Confirm the exact deployment target.** Use the Sepolia network only. Confirm `eth_chainId` reports `0xaa36a7` and confirm the configured network name, RPC provider, and wallet address.
3. **Review CTF availability.** Search official project documentation and trusted deployment registries for an official CTF deployment on Sepolia. Confirm the address on more than one trustworthy source, inspect its bytecode and verified source, and verify relevant behavior. If no suitable deployment exists, stop and request a decision before deploying the CTF source ourselves.
4. **Choose collateral.** Select and verify a Sepolia ERC-20 token. Confirm its address, code, decimals, transfer behavior, and test-token status. Do not assume the project’s `MockCollateral` is an existing token.
5. **Prepare secrets and a test wallet.** Use a dedicated wallet with only faucet test ETH. Configure the RPC URL and private key through Hardhat’s supported secret/configuration mechanism. Confirm `.env` remains ignored and do not commit secrets.
6. **Use the prepared Hardhat 3 Viem scripts.** `scripts/deploy-sepolia-collateral.ts` can deploy the existing `MockCollateral`, clearly labeled as an educational test token. `scripts/deploy-sepolia-adapter.ts` requires CTF and collateral addresses, checks their code, and requires `CONFIRM_CTF_ADDRESS_VERIFIED`. Both require the exact `CONFIRM_SEPOLIA_ONLY` value, explicitly connect to the `sepolia` network, compare the RPC chain ID, print the deployer and balance, wait for two confirmations, and print addresses and transaction hashes. The adapter script does not deploy CTF or silently choose either address.
7. **Deploy only the adapter or specifically approved components.** If reusing verified CTF and collateral, deploy `LocalCTFAdapter` with those exact addresses. If deploying any token or CTF ourselves, require a separate explicit approval and label test collateral clearly.
8. **Check the result before interacting.** Wait for confirmations; verify deployed bytecode at the printed address; read `ctf()` and `collateral()` from the adapter on Sepolia Etherscan or with a read-only Viem call; compare both with the intended constructor addresses. The scripts print each deployment address, transaction hash, and Sepolia explorer link. Run a small Sepolia-only smoke check only after approval, using test ETH and a non-production test condition.
9. **Verify source on an explorer.** Open the deployment transaction and address on Sepolia Etherscan. Submit source verification using the exact source set, Solidity compiler version (`0.8.34` for the adapter, `0.5.10` for official CTF if we deployed it), optimizer settings (enabled, 200 runs), and constructor arguments. For the adapter, provide the exact CTF and collateral constructor addresses. The official Hardhat 3 verification plugin is available, but it needs to be installed and configured first; manual explorer verification is another option. [Hardhat 3 verification support](https://hardhat.org/docs/plugins/official-plugins) · [Sepolia Etherscan](https://sepolia.etherscan.io/).
10. **Save deployment records safely.** Commit only non-secret metadata (network, chain ID, contract addresses, transaction hashes, compiler settings, and source commit). Never commit `.env`, keys, RPC credentials, or wallet recovery phrases.

## What needs my review before implementation

- Which verified Sepolia CTF deployment and collateral token should be used? No addresses are supplied or assumed in this document.
- If no trustworthy CTF deployment is available, do I want a separate review/approval step for deploying the official CTF source and a clearly labeled test collateral token?
- Which verified Sepolia CTF address and collateral address should I configure? The CTF address is currently unverified, so adapter deployment is not ready.
- Which dedicated test wallet and RPC provider will I use?

No deployment was attempted. The official CTF deployment requirements are not unclear at the source level: the package provides `ConditionalTokens` with a no-argument constructor, `CTHelpers` is compiled into its caller rather than linked as a deployed library, and the implementation includes its own legacy ERC-1155 source while importing `openzeppelin-solidity` 2.3.0 at compile time. The project pins the official CTF package and uses Solidity `0.5.10` for its `^0.5.1` source, separate from my `0.8.34` contracts. There is no external constructor dependency to deploy first. However, because I could not verify an official Sepolia deployment, deploying the official CTF itself would still need a dedicated review/approval before any transaction.
