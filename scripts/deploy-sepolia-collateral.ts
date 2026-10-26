import { connectToSepoliaForDeployment } from "./lib/sepolia-guard.js";
import {
  checkMockCollateralDeploymentCost,
  loadMockCollateralArtifact,
  SafeMockCollateralDeploymentError,
  verifyMockCollateralDeployment,
} from "./lib/mock-collateral-deployment-check.js";
import { formatSubmittedDeploymentDetails } from "./lib/deployment-failure-details.js";
import {
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

// This script deploys the MockCollateral contract to Sepolia and verifies that the deployment was successful.
// It is intended for educational purposes and should not be used in production environments
const mockCollateralReadAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

let submittedDeployment:
  | { transactionHash: string; contractAddress: string }
  | undefined;
let currentStage = "Sepolia connection";

async function main() {
  const { viem, publicClient, walletClient } =
    await connectToSepoliaForDeployment();

  console.log("Deploying MockCollateral as an educational Sepolia test token.");
  console.log("This token is not a production collateral asset.");

  currentStage = "MockCollateral artifact validation";
  const artifact = await loadMockCollateralArtifact();

  currentStage = "read-only gas and balance preflight";
  await checkMockCollateralDeploymentCost(
    publicClient,
    walletClient.account.address,
    artifact.creation,
  );

  currentStage = "deployment transaction submission";
  const { contract, deploymentTransaction } =
    await viem.sendDeploymentTransaction("MockCollateral");
  // Hardhat Viem exposes both public identifiers as soon as submission returns.
  submittedDeployment = {
    transactionHash: deploymentTransaction.hash,
    contractAddress: contract.address,
  };

  currentStage = "two-confirmation receipt check";
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: deploymentTransaction.hash,
    confirmations: 2,
  });

  if (receipt.status !== "success") {
    throw new SafeMockCollateralDeploymentError(
      "The deployment receipt reports an unsuccessful transaction status.",
    );
  }

  currentStage = "runtime bytecode and token metadata verification";
  const readToken = async (address: Address, data: Hex) => {
    const response = await publicClient.request({
      method: "eth_call",
      params: [{ to: address, data }, "latest"],
    });
    return response as Hex;
  };
  const readString = async (
    address: Address,
    functionName: "name" | "symbol",
  ) =>
    decodeFunctionResult({
      abi: mockCollateralReadAbi,
      functionName,
      data: await readToken(
        address,
        encodeFunctionData({ abi: mockCollateralReadAbi, functionName }),
      ),
    });
  const readUint = async (
    address: Address,
    functionName: "decimals" | "totalSupply",
  ) =>
    decodeFunctionResult({
      abi: mockCollateralReadAbi,
      functionName,
      data: await readToken(
        address,
        encodeFunctionData({ abi: mockCollateralReadAbi, functionName }),
      ),
    });
  await verifyMockCollateralDeployment(
    {
      getCode: ({ address }) => publicClient.getCode({ address }),
      readName: ({ address }) => readString(address, "name"),
      readSymbol: ({ address }) => readString(address, "symbol"),
      readDecimals: ({ address }) => readUint(address, "decimals"),
      readTotalSupply: ({ address }) => readUint(address, "totalSupply"),
      readBalanceOf: async ({ address, account }) => {
        const data = await readToken(
          address,
          encodeFunctionData({
            abi: mockCollateralReadAbi,
            functionName: "balanceOf",
            args: [account],
          }),
        );
        return decodeFunctionResult({
          abi: mockCollateralReadAbi,
          functionName: "balanceOf",
          data,
        });
      },
    },
    contract.address,
    walletClient.account.address,
    artifact.runtime,
  );

  console.log(`MockCollateral address: ${contract.address}`);
  console.log(`Deployment transaction: ${deploymentTransaction.hash}`);
  console.log(`Sepolia explorer: https://sepolia.etherscan.io/address/${contract.address}`);
  console.log("Runtime bytecode matches the compiled artifact.");
  console.log("Verified name, symbol, decimals, total supply, and deployer balance.");
}

main().catch((error: unknown) => {
  const message =
    error instanceof SafeMockCollateralDeploymentError
      ? error.safeDiagnostic
      : `Unexpected failure during ${currentStage}. Raw provider details were withheld.`;
  console.error(`MockCollateral deployment stopped during ${currentStage}: ${message}`);
  for (const detail of formatSubmittedDeploymentDetails(submittedDeployment)) {
    console.error(detail);
  }
  process.exitCode = 1;
});
