import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  type Address,
  type Hex,
} from "viem";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  INTEGRATION_ADDRESSES,
  loadIntegrationArtifacts,
  loadRpcUrl,
} from "./lib/sepolia-integration-preflight.js";
import { loadLocalEnv } from "./lib/load-local-env.js";
import {
  APPROVAL_WALLET,
  MOCK_APPROVAL_AMOUNT,
  MOCK_APPROVAL_CONFIRMATION,
  MockCollateralApprovalError,
  parseApprovalMode,
  runMockCollateralApproval,
  type ApprovalReader,
  type ApprovalResult,
} from "./lib/mock-collateral-approval.js";

function readErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown error";
}

function printPreflight(result: ApprovalResult): void {
  console.log("Operation: MockCollateral.approve(adapter, 1 MOCK)");
  console.log(`Network: Ethereum Sepolia (chain ID 11155111)`);
  console.log(`Token: ${result.token} (Mock Collateral, MOCK)`);
  console.log(`Spender: ${result.spender}`);
  console.log(`Amount: 1 MOCK (${result.amount} base units)`);
  console.log(`Wallet: ${result.wallet}`);
  console.log(`Wallet MOCK balance: ${formatUnits(result.tokenBalance, 18)} MOCK (${result.tokenBalance} base units)`);
  console.log(`Current allowance: ${formatUnits(result.currentAllowance, 18)} MOCK (${result.currentAllowance} base units)`);
  console.log(`Estimated gas: ${result.gasEstimate}`);
  console.log("Approval simulation succeeded. No transaction has been sent.");
}

async function main(): Promise<void> {
  const mode = parseApprovalMode(process.argv.slice(2));
  const artifacts = await loadIntegrationArtifacts();
  const rpcUrl = await loadRpcUrl(process.env.SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  const reader: ApprovalReader = {
    getChainId: () => publicClient.getChainId(),
    getCode: (address) => publicClient.getCode({ address }),
    getTokenMetadata: async () => {
      const [name, symbol, decimals] = await Promise.all([
        publicClient.readContract({
          address: INTEGRATION_ADDRESSES.collateral,
          abi: artifacts.collateral.abi,
          functionName: "name",
        } as never) as Promise<string>,
        publicClient.readContract({
          address: INTEGRATION_ADDRESSES.collateral,
          abi: artifacts.collateral.abi,
          functionName: "symbol",
        } as never) as Promise<string>,
        publicClient.readContract({
          address: INTEGRATION_ADDRESSES.collateral,
          abi: artifacts.collateral.abi,
          functionName: "decimals",
        } as never) as Promise<number>,
      ]);
      return { name, symbol, decimals };
    },
    getAdapterCollateral: () => publicClient.readContract({
      address: INTEGRATION_ADDRESSES.adapter,
      abi: artifacts.adapter.abi,
      functionName: "collateral",
    } as never) as Promise<Address>,
    getTokenBalance: (wallet) => publicClient.readContract({
      address: INTEGRATION_ADDRESSES.collateral,
      abi: artifacts.collateral.abi,
      functionName: "balanceOf",
      args: [wallet],
    } as never) as Promise<bigint>,
    getAllowance: (wallet) => publicClient.readContract({
      address: INTEGRATION_ADDRESSES.collateral,
      abi: artifacts.collateral.abi,
      functionName: "allowance",
      args: [wallet, INTEGRATION_ADDRESSES.adapter],
    } as never) as Promise<bigint>,
    simulateApprove: async (wallet, spender, amount) => {
      await publicClient.simulateContract({
        account: wallet,
        address: INTEGRATION_ADDRESSES.collateral,
        abi: artifacts.collateral.abi,
        functionName: "approve",
        args: [spender, amount],
      } as never);
    },
    estimateApprove: (wallet, spender, amount) => publicClient.estimateContractGas({
      account: wallet,
      address: INTEGRATION_ADDRESSES.collateral,
      abi: artifacts.collateral.abi,
      functionName: "approve",
      args: [spender, amount],
    } as never),
    submitApprove: async (wallet, spender, amount) => {
      // Load the private key and create a wallet client only after explicit confirmation.
      loadLocalEnv();
      const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
      if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
        throw new MockCollateralApprovalError("A valid SEPOLIA_PRIVATE_KEY is required for confirmed approval.");
      }
      const account = privateKeyToAccount(privateKey as Hex);
      if (account.address.toLowerCase() !== wallet.toLowerCase()) {
        throw new MockCollateralApprovalError("Configured signer does not match the expected wallet; no approval was sent.");
      }
      const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
      return walletClient.writeContract({
        account,
        address: INTEGRATION_ADDRESSES.collateral,
        abi: artifacts.collateral.abi,
        functionName: "approve",
        args: [spender, amount],
      } as never);
    },
    waitForReceipt: async (hash) => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
      return receipt.status;
    },
  };

  const result = await runMockCollateralApproval(
    APPROVAL_WALLET,
    mode === "submit" ? async () => {
      const prompt = createInterface({ input: stdin, output: stdout });
      try {
        return await prompt.question(`To submit only this approval, type exactly: ${MOCK_APPROVAL_CONFIRMATION}\n> `);
      } finally {
        prompt.close();
      }
    } : undefined,
    reader,
    {
      collateralRuntime: artifacts.collateral.runtime,
      adapterRuntime: artifacts.adapter.runtime,
      adapterImmutableReferences: artifacts.adapter.immutableReferences,
    },
    printPreflight,
  );
  if (!result.submitted) {
    console.log("Read-only preflight complete. To request submission, rerun with --submit; the command will show fresh checks and then ask for the exact confirmation phrase.");
    return;
  }
  console.log(`Verified allowance: ${result.verifiedAllowance} base units (at least 1 MOCK).`);
  console.log(`Approval transaction: ${result.transactionHash}`);
  console.log(`Sepolia Etherscan: https://sepolia.etherscan.io/tx/${result.transactionHash}`);
}

main().catch((error: unknown) => {
  if (error instanceof MockCollateralApprovalError) {
    console.error(`MOCK approval stopped: ${error.message}`);
    if (error.transactionHash) {
      console.error(`Transaction: ${error.transactionHash}`);
      console.error(`Sepolia Etherscan: https://sepolia.etherscan.io/tx/${error.transactionHash}`);
    }
  } else {
    console.error(`MOCK approval stopped (${readErrorName(error)}). Sensitive provider details were withheld.`);
  }
  process.exitCode = 1;
});
