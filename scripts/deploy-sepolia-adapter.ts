import {
  connectToSepoliaForDeployment,
  requireSepoliaContractCode,
} from "./lib/sepolia-guard.js";

async function main() {
  const { viem, publicClient } = await connectToSepoliaForDeployment();

  if (
    process.env.CONFIRM_CTF_ADDRESS_VERIFIED !==
    "I_VERIFIED_THE_OFFICIAL_CTF_SOURCE_AND_SEPOLIA_ADDRESS"
  ) {
    throw new Error(
      "Refusing to deploy the adapter until you independently verify the official CTF source and Sepolia address.",
    );
  }

  const ctfAddress = await requireSepoliaContractCode(
    publicClient,
    "SEPOLIA_CTF_ADDRESS",
    process.env.SEPOLIA_CTF_ADDRESS,
  );
  const collateralAddress = await requireSepoliaContractCode(
    publicClient,
    "SEPOLIA_COLLATERAL_ADDRESS",
    process.env.SEPOLIA_COLLATERAL_ADDRESS,
  );

  console.log("CTF address has code, but this check does not prove it is official or safe.");
  console.log("Confirm its provenance and verified source before continuing.");
  console.log(`Adapter constructor CTF: ${ctfAddress}`);
  console.log(`Adapter constructor collateral: ${collateralAddress}`);

  const { contract, deploymentTransaction } = await viem.sendDeploymentTransaction(
    "LocalCTFAdapter",
    [ctfAddress, collateralAddress],
  );
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: deploymentTransaction.hash,
    confirmations: 2,
  });

  if (receipt.status !== "success") {
    throw new Error(`LocalCTFAdapter deployment failed: ${deploymentTransaction.hash}`);
  }

  console.log(`LocalCTFAdapter address: ${contract.address}`);
  console.log(`Deployment transaction: ${deploymentTransaction.hash}`);
  console.log(`Sepolia explorer: https://sepolia.etherscan.io/address/${contract.address}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
