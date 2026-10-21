import { connectToSepoliaForDeployment } from "./lib/sepolia-guard.js";

async function main() {
  const { viem, publicClient } = await connectToSepoliaForDeployment();

  console.log("Deploying MockCollateral as an educational Sepolia test token.");
  console.log("This token is not a production collateral asset.");

  const { contract, deploymentTransaction } =
    await viem.sendDeploymentTransaction("MockCollateral");
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: deploymentTransaction.hash,
    confirmations: 2,
  });

  if (receipt.status !== "success") {
    throw new Error(`MockCollateral deployment failed: ${deploymentTransaction.hash}`);
  }

  console.log(`MockCollateral address: ${contract.address}`);
  console.log(`Deployment transaction: ${deploymentTransaction.hash}`);
  console.log(`Sepolia explorer: https://sepolia.etherscan.io/address/${contract.address}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
