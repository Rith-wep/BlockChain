# My Sepolia deployment preparation

## Goal and current status

I am learning how to deploy and verify contracts on Ethereum Sepolia. The project has a guarded deployment workflow, and I have now deployed and verified the official Gnosis Conditional Token Framework (CTF) `ConditionalTokens` contract on Sepolia. I have not deployed the adapter, collateral token, registry, or any other project contract.

The preparation notes below include decisions and plans recorded before the CTF deployment. The **Completed CTF deployment record** near the end is the source of truth for what actually happened.

Sepolia is an Ethereum test network for application development. It is not Mainnet, but testnet deployments are still public and permanent on that testnet. I will only use test ETH and a wallet made for testing. [Ethereum.org recommends Sepolia for application development](https://ethereum.org/developers/docs/networks/).

## What I found in my project

- The project currently has Hardhat `3.20.0`, `@nomicfoundation/hardhat-toolbox-viem` `5.0.7`, Solidity compiler settings for `0.8.34` and `0.5.10`, and `@gnosis.pm/conditional-tokens-contracts` `1.0.3`.
- `hardhat.config.ts` configures the Viem toolbox, both Solidity compilers, and a Sepolia-only HTTP network with chain ID `11155111`. The RPC URL and deployer key come from environment variables.
- `package.json` includes local compile/test scripts and guarded Sepolia deployment scripts. The CTF deployment script is `scripts/deploy-sepolia-ctf.ts`; local automated tests are separate and do not deploy to Sepolia.
- The project includes the official CTF package and compiles its `ConditionalTokens.sol` source locally. The official source uses Solidity `^0.5.1`, so this project uses the separate `0.5.10` compiler for that source and `0.8.34` for my own contracts. This preserves compiler compatibility without changing either version. The official source is in the [Gnosis CTF repository](https://github.com/gnosis/conditional-tokens-contracts/blob/master/contracts/ConditionalTokens.sol).
- The package listing in the official repository shows some historical deployment networks but does not list Sepolia. At the start of preparation, my project had no CTF address. I did not assume a compatible contract already existed: I deployed the pinned package myself and checked its address and runtime bytecode. I still need to configure and review that address when I prepare the adapter.
- The official Gnosis deployment list did not provide a Sepolia address I could verify. After reviewing the deployment plan, I deployed the pinned official CTF package myself to Sepolia. The deployment and bytecode verification are recorded below; this is my deployment of the official source, not a claim that Gnosis published or operates this address.
- `.gitignore` ignores `.env` and `.env.*` while allowing `.env.example`. My local `.env` is used for development and must remain untracked. `.env.example` must contain placeholders only, never a real key or RPC credential.

## Contracts and addresses I need

| Contract | What it does | Sepolia action needed |
| --- | --- | --- |
| Official `ConditionalTokens` (CTF) | Holds collateral and creates, merges, and redeems ERC-1155 outcome positions. The adapter calls its CTF interface. | Deployed and verified on Sepolia at the address in the deployment record below. Do not substitute `EducationalCTFMock`. |
| Collateral ERC-20 | The asset used to back positions and pay redemptions. | Choose an existing, verified Sepolia token and verify its address, code, decimals, and issuer/source. The local `MockCollateral` is for practice and should not be mistaken for a real collateral asset. |
| `LocalCTFAdapter` | Routes a user’s collateral and outcome positions through CTF. | Deploy after the CTF and collateral addresses are verified. Its constructor is `LocalCTFAdapter(address ctfAddress, address collateralAddress)`; it rejects zero addresses and addresses with no code. |
| `QuestionRegistry` | Stores questions and lets each creator resolve their own question. | Optional, separate practice deployment. It is not a dependency of `LocalCTFAdapter` or the official CTF. |
| `QuestionReader` | Reads from a previously deployed `QuestionRegistry`. | Optional. Deploy only after the registry and pass its address to the constructor. |
| `PracticeToken`, `PracticePositions`, `MockCollateral`, `EducationalCTFMock`, and the educational CTF ID harness | Learning-only contracts and examples. | Do not deploy these as production-market dependencies. In particular, the educational CTF mock is not Gnosis CTF. |

The official `ConditionalTokens` contract has no constructor arguments in its source (its ERC-1155 base constructor also takes no arguments). The local CTF source imports its own legacy ERC-1155 and helper code plus the package’s legacy OpenZeppelin dependency; these are compile-time source dependencies, not constructor addresses. The project’s `LocalCTFAdapter` only talks to the functions in `IConditionalTokens.sol` and stores the supplied CTF/collateral addresses.

The CTF deploy requirements visible in the source are: deploy `ConditionalTokens` with no constructor arguments; compile its `^0.5.1` source with the compatible compiler `0.5.10`; and use the pinned compile-time `openzeppelin-solidity` `2.3.0` source dependency. `CTHelpers` is compiled into the contract, so no separate library address is needed. Its collection-ID math uses the EVM `0x06` elliptic-curve addition precompile. I deployed the pinned package and verified the runtime bytecode as described below. That confirms the deployed bytecode matches the local artifact; it does not make the contract independently audited or production-ready.

For a binary market, I will also need to choose an oracle address and a unique `bytes32` question ID. The CTF condition is prepared for that oracle and question ID with two outcome slots. Only the same oracle address can report payouts because the official CTF derives the condition ID using the caller of `reportPayouts`. I must control the oracle account or have an explicit oracle process; deploying the adapter does not give it oracle authority.

## Sepolia configuration (prepared locally)

Hardhat 3 documents an HTTP network configuration with `chainType: "l1"`, URL/account configuration variables, and a chain ID. This project uses the following Sepolia configuration: [Hardhat 3 network configuration](https://hardhat.org/docs/reference/configuration).

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

## Original deployment plan

This was the plan I used before the CTF deployment. Completed CTF deployment steps are detailed later in this document.

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

## Remaining decisions before deploying more contracts

- Which verified Sepolia CTF deployment and collateral token should be used? No addresses are supplied or assumed in this document.
- If no trustworthy CTF deployment is available, do I want a separate review/approval step for deploying the official CTF source and a clearly labeled test collateral token?
- Which Sepolia collateral token should I use? The deployed CTF address is verified against the pinned artifact, but no collateral token has been selected or deployed.
- Which dedicated test wallet and RPC provider will I use?

The CTF contract has no constructor arguments or external library address. Its legacy Solidity `0.5.10` build remains separate from my Solidity `0.8.34` contracts. The verified deployment record below documents the exact result.

## My current CTF deployment preflight

I added a read-only preflight command before any deployment. It loads the ignored `.env` file with Node's built-in environment-file loader when that file exists, then reads `SEPOLIA_RPC_URL`, `SEPOLIA_PRIVATE_KEY`, and `CONFIRM_SEPOLIA_ONLY` from the process environment. Existing shell variables take precedence. The private key is used only in memory to derive the public deployer address; this command does not sign or send a transaction and never prints the key or RPC URL. The same loader runs before Hardhat configuration is evaluated, so the deployment scripts can use the same local `.env` values.

After I have set those variables in the same PowerShell session, I run:

```powershell
npm.cmd run preflight:sepolia:ctf
```

The confirmation value must be exactly `I_UNDERSTAND_SEPOLIA_TESTNET_ONLY`. The preflight requires RPC chain ID `11155111`, reads the compiled official `ConditionalTokens` artifact at the expected package source path, checks that it has no constructor arguments or linked libraries, asks the Sepolia RPC to estimate deployment gas and an EIP-1559 max-fee quote, reads the wallet balance, and requires balance for the maximum estimate plus a 25% reserve. It prints the public deployer address, fee quote, estimate, cost, and balance. A successful run ends with `Preflight passed. No transaction was signed or sent.` Missing variables are reported by name only; RPC/provider details are intentionally redacted on failure.

The CTF deployment script repeats the gas and balance check immediately before its existing guarded deployment call. It checks the RPC chain ID through the explicitly selected Sepolia network, waits for two confirmations, checks for runtime code, and compares the deployed runtime bytecode with the compiled artifact. On success it reports the verified address and transaction hash; if a later receipt or code check fails after submission, it reports the submitted transaction hash and predicted address without printing raw provider errors. This preflight is a safety aid, not a guarantee of the final mined gas cost or successful deployment; network conditions can change after estimation.

## How my practice contracts fit together

`QuestionRegistry` and `QuestionReader` are standalone learning examples. `QuestionRegistry.resolveQuestion` records a boolean outcome in that contract's own storage, while `QuestionReader` only reads a registry address passed to its constructor. Neither contract is connected to Gnosis CTF. In particular, resolving a registry question does not prepare a CTF condition or report a CTF payout.

`LocalCTFAdapter` is the CTF integration exercise. Its constructor receives the CTF and collateral addresses. A user approves the adapter to spend collateral, then calls `splitBinary`; the adapter pulls collateral, approves CTF, calls the real CTF split function, and forwards the two ERC-1155 positions back to that user. For merging and redemption, the user first approves the adapter as an ERC-1155 operator; the adapter pulls the positions, calls CTF, and returns collateral proceeds to the caller. The adapter does not automatically prepare conditions, choose an oracle, or report outcomes.

The CTF condition lifecycle therefore also needs an oracle process: an oracle calls the official CTF's public `prepareCondition(oracle, questionId, 2)` before positions can be split. After the real-world question is resolved, the same oracle address must call `reportPayouts(questionId, payouts)` on CTF. The adapter cannot do this on the oracle's behalf, and the practice registry's creator-based resolution is not wired to it. I have not built or selected an oracle service in this learning project.

My safe order from here is: (1) keep the verified CTF address and transaction details in non-secret deployment records, (2) select or separately approve a clearly labeled Sepolia collateral token, (3) verify its source and behavior, (4) review and separately approve deploying the adapter with the verified CTF and collateral addresses, and (5) only then test a condition using an oracle I control. The CTF deployment is complete; the other steps have not been performed.

## Completed CTF deployment record

This section records what I deployed and how I checked it. The operation used Sepolia test ETH only. A blockchain deployment is public and persistent on that test network, even though the ETH has no Mainnet value.

### What I deployed

- Contract: the official Gnosis Conditional Token Framework `ConditionalTokens` contract.
- Package: `@gnosis.pm/conditional-tokens-contracts` version `1.0.3`.
- Network: Ethereum Sepolia, chain ID `11155111` (hexadecimal `0xaa36a7`).
- Deployer: `0x8CFbcFC0e1C974970f03627e820dED0C95a7b6FA`.
- Constructor arguments: none.
- Compiler settings: Solidity `0.5.10`, optimizer enabled with 200 runs, EVM target `petersburg`. The project’s Solidity `0.8.34` contracts were not recompiled with this legacy compiler.

I deployed only `ConditionalTokens`. This deployment did not deploy `LocalCTFAdapter`, collateral, `QuestionRegistry`, or any learning mock.

### Checks before sending the deployment

I ran the read-only command:

```powershell
npm.cmd run preflight:sepolia:ctf
```

The preflight checked the configured RPC chain ID, derived the public deployer address from the key in memory, checked the official artifact, estimated gas and an EIP-1559 fee, and checked the wallet balance against an estimated cost plus a 25% reserve. It did not sign or send a transaction.

The successful preflight run before deployment reported:

| Item | Preflight result |
| --- | ---: |
| Chain ID | `11155111` (Sepolia) |
| Deployer | `0x8CFbcFC0e1C974970f03627e820dED0C95a7b6FA` |
| Estimated gas | `23,457,183` gas |
| Quoted max fee | `153,614` wei/gas (`0.000153614` gwei/gas) |
| Quoted priority fee | `153,596` wei/gas |
| Estimated maximum cost | `0.000003603351709362 ETH` |
| Required balance with 25% reserve | `0.000004504189636703 ETH` |
| Balance at preflight | `0.05 ETH` |

The phrase `CONFIRM_SEPOLIA_ONLY=I_UNDERSTAND_SEPOLIA_TESTNET_ONLY` was required by the deployment guard. The deployment command was:

```powershell
npm.cmd run deploy:sepolia:ctf
```

That command submitted the deployment transaction. The preflight command alone would not have deployed anything.

### Transaction and contract addresses

- Transaction hash: [`0x22721949492a6ec5e5d8488a2933d52bcaa2c0788ece311cede86ee27d00e149`](https://sepolia.etherscan.io/tx/0x22721949492a6ec5e5d8488a2933d52bcaa2c0788ece311cede86ee27d00e149)
- Deployed contract: [`0x0CF01081fa2843BD187AC1A52C5a32C02211ee36`](https://sepolia.etherscan.io/address/0x0CF01081fa2843BD187AC1A52C5a32C02211ee36)
- Receipt block: `11,994,039`
- Receipt status: `success`

The transaction is a contract creation, its sender matches the deployer above, and the receipt’s contract address matches the deployed address above.

### Actual fee and current balance

The receipt—not the earlier estimate—provides the actual gas used and effective gas price:

| Item | Receipt / RPC result |
| --- | ---: |
| Gas used | `23,271,323` gas |
| Effective gas price | `1,000,000,000` wei/gas (`1` gwei/gas) |
| Actual transaction fee | `23,271,323 × 1,000,000,000 = 23,271,323,000,000,000` wei (`0.023271323 ETH`) |
| Current deployer balance at verification | `26,728,677,000,000,000` wei (`0.026728677 ETH`) |

The earlier preflight fee quote (`153,614` wei/gas) was much lower than the receipt’s actual effective price (`1,000,000,000` wei/gas). Actual gas use was `185,860` gas below the estimate, but that small difference does not offset the fee-price difference. These are values from the earlier preflight and the later receipt; the receipt proves the actual fee, but it does not explain why the earlier RPC quote was so low. A preflight is an estimate, not a promise of the final fee. In this case, the 25% reserve based on that quote did not predict the eventual cost accurately.

The current balance is `0.026728677 ETH`. Compared with the earlier reported `0.05 ETH`, the difference is `0.023271323 ETH`, equal to this receipt’s fee if the earlier balance was exactly `0.05 ETH` and there were no other balance changes. Since the earlier amount was reported as approximate, this comparison is not proof that no other transactions occurred.

### Runtime bytecode verification

After the receipt succeeded, I read the deployed address’s runtime code and compared it with the `deployedBytecode` in the local artifact from the pinned version `1.0.3` package.

- Contract code exists at the deployed address: **yes**.
- Runtime bytecode length: `14,771` bytes.
- Exact runtime bytecode match with the pinned artifact: **yes**.

This confirms the code at the address matches the local compiled artifact. It does not mean the contract or this learning project has been audited, nor does it make it suitable for handling real funds.

### Beginner glossary

- **Transaction hash:** the public identifier for a submitted blockchain transaction. It can be opened in a block explorer to see its status and details.
- **Receipt:** the network’s final record after a transaction is included in a block. A `success` status means the deployment transaction completed without reverting.
- **Gas:** the computation units consumed by an EVM transaction. `gasUsed` is the amount actually consumed.
- **Wei and gwei:** units for ETH fees. `1 gwei = 1,000,000,000 wei`; `1 ETH = 1,000,000,000,000,000,000 wei`.
- **Effective gas price:** the actual per-gas price charged for the mined transaction. Multiplying it by `gasUsed` gives the actual transaction fee.
- **Runtime bytecode:** the program stored at a deployed contract address. Comparing it with the expected artifact checks that the deployed code matches the compiled contract.

### What I should do next

Keep this CTF address and transaction hash as non-secret project records. Before using it, independently open the Sepolia explorer links and confirm the same receipt and address. Then choose a Sepolia collateral token and review it separately. Deploying collateral or `LocalCTFAdapter` is a separate action and requires its own review; none of those contracts is included in this deployment record.
