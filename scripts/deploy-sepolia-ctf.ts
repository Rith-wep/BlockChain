import { connectToSepoliaForDeployment } from "./lib/sepolia-guard.js";

async function main() {
  const { viem, publicClient } = await connectToSepoliaForDeployment();

  console.log(
    "Deploying ConditionalTokens from the pinned @gnosis.pm/conditional-tokens-contracts 1.0.3 package.",
  );
  console.log("This official contract has no constructor arguments.");
  console.log(
    "Its artifact is compiled with Solidity 0.5.10, optimizer enabled (200 runs), and EVM target petersburg, separately from the 0.8.34 project contracts.",
  );

  const { contract, deploymentTransaction } =
    await viem.sendDeploymentTransaction("ConditionalTokens");
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: deploymentTransaction.hash,
    confirmations: 2,
  });

  if (receipt.status !== "success") {
    throw new Error(
      `ConditionalTokens deployment failed: ${deploymentTransaction.hash}`,
    );
  }

  const deployedCode = await publicClient.getCode({ address: contract.address });
  if (deployedCode === undefined || deployedCode === "0x") {
    throw new Error(
      `No contract code found after deployment at ${contract.address}.`,
    );
  }

  console.log(`ConditionalTokens address: ${contract.address}`);
  console.log(`Deployment transaction: ${deploymentTransaction.hash}`);
  console.log(
    `Verify source and compiler settings: https://sepolia.etherscan.io/address/${contract.address}#code`,
  );
  console.log(
    "Compare verified source and deployed bytecode with the pinned 1.0.3 source and this project's 0.5.10 compiler settings.",
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
