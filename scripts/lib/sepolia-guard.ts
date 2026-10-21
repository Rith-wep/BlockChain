import type {} from "@nomicfoundation/hardhat-toolbox-viem";
import { network } from "hardhat";

export const SEPOLIA_CHAIN_ID = 11155111;
const SEPOLIA_CONFIRMATION = "I_UNDERSTAND_SEPOLIA_TESTNET_ONLY";

export async function connectToSepoliaForDeployment() {
  if (process.env.CONFIRM_SEPOLIA_ONLY !== SEPOLIA_CONFIRMATION) {
    throw new Error(
      `Refusing to deploy. Set CONFIRM_SEPOLIA_ONLY=${SEPOLIA_CONFIRMATION} after reviewing the Sepolia-only plan.`,
    );
  }

  // Select the configured Sepolia endpoint explicitly; do not inherit a default network.
  const { viem } = await network.create({ network: "sepolia" });
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Refusing to deploy: RPC returned chain ID ${chainId}; expected Sepolia ${SEPOLIA_CHAIN_ID}.`,
    );
  }

  const [walletClient] = await viem.getWalletClients();
  if (walletClient === undefined) {
    throw new Error("Refusing to deploy: no deployer wallet is configured.");
  }

  const deployerAddress = walletClient.account.address;
  const balance = await publicClient.getBalance({ address: deployerAddress });

  console.log(`Verified chain ID: ${chainId} (Sepolia)`);
  console.log(`Deployer: ${deployerAddress}`);
  console.log(`Deployer Sepolia ETH balance: ${balance} wei`);

  return { viem, publicClient, walletClient, deployerAddress };
}

export async function requireSepoliaContractCode(
  publicClient: Awaited<ReturnType<typeof connectToSepoliaForDeployment>>["publicClient"],
  label: string,
  value: string | undefined,
): Promise<`0x${string}`> {
  if (value === undefined || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label} must be set to a valid 20-byte EVM address.`);
  }

  const address = value as `0x${string}`;
  const code = await publicClient.getCode({ address });
  if (code === undefined || code === "0x") {
    throw new Error(`${label} ${address} has no deployed contract code on Sepolia.`);
  }

  return address;
}
