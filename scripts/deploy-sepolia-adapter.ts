import {
  connectToSepoliaForDeployment,
} from "./lib/sepolia-guard.js";
import {
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  type Hex,
} from "viem";
import {
  checkAdapterDeploymentCost,
  encodeLocalCTFAdapterDeployment,
  EXPECTED_SEPOLIA_COLLATERAL_ADDRESS,
  EXPECTED_SEPOLIA_CTF_ADDRESS,
  formatAdapterDeploymentFailure,
  loadLocalCTFAdapterArtifact,
  parseAdapterPreflightOnly,
  requireAdapterContractCode,
  SafeAdapterDeploymentError,
  submitAdapterDeploymentUnlessPreflightOnly,
  validateExpectedAdapterAddress,
  verifyAdapterConstructorAddresses,
  verifyLocalCTFAdapterRuntime,
} from "./lib/adapter-deployment-check.js";

const adapterConfigurationAbi = parseAbi([
  "function ctf() view returns (address)",
  "function collateral() view returns (address)",
]);

let currentStage = "Sepolia connection";
let submittedDeployment:
  | { transactionHash: string; contractAddress: string }
  | undefined;

async function main() {
  // Set PREFLIGHT_ONLY=true to run every read-only check and stop before submission.
  const preflightOnly = parseAdapterPreflightOnly(process.env.PREFLIGHT_ONLY);
  const { viem, publicClient, walletClient } =
    await connectToSepoliaForDeployment();

  currentStage = "CTF provenance confirmation";
  if (
    process.env.CONFIRM_CTF_ADDRESS_VERIFIED !==
    "I_VERIFIED_THE_OFFICIAL_CTF_SOURCE_AND_SEPOLIA_ADDRESS"
  ) {
    throw new Error(
      "Refusing to deploy the adapter until you independently verify the official CTF source and Sepolia address.",
    );
  }

  currentStage = "constructor address validation";
  const ctfAddress = validateExpectedAdapterAddress(
    "SEPOLIA_CTF_ADDRESS",
    process.env.SEPOLIA_CTF_ADDRESS,
    EXPECTED_SEPOLIA_CTF_ADDRESS,
  );
  const collateralAddress = validateExpectedAdapterAddress(
    "SEPOLIA_COLLATERAL_ADDRESS",
    process.env.SEPOLIA_COLLATERAL_ADDRESS,
    EXPECTED_SEPOLIA_COLLATERAL_ADDRESS,
  );

  currentStage = "read-only constructor address code checks";
  await requireAdapterContractCode(publicClient, "CTF", ctfAddress);
  await requireAdapterContractCode(publicClient, "MockCollateral", collateralAddress);
  console.log("Both constructor addresses have code on Sepolia.");
  console.log("Code presence does not prove contract identity, source verification, or provenance.");
  console.log("Independently verify both addresses and the CTF source before deployment.");
  console.log(`Adapter constructor CTF: ${ctfAddress}`);
  console.log(`Adapter constructor collateral: ${collateralAddress}`);

  currentStage = "LocalCTFAdapter artifact validation";
  const artifact = await loadLocalCTFAdapterArtifact();
  const deploymentData = encodeLocalCTFAdapterDeployment(
    artifact,
    ctfAddress,
    collateralAddress,
  );

  currentStage = "read-only gas and balance preflight";
  await checkAdapterDeploymentCost(
    publicClient,
    walletClient.account.address,
    deploymentData,
  );

  currentStage = preflightOnly
    ? "read-only preflight completion"
    : "deployment transaction submission";
  const submitted = await submitAdapterDeploymentUnlessPreflightOnly(
    preflightOnly,
    () =>
      viem.sendDeploymentTransaction("LocalCTFAdapter", [
        ctfAddress,
        collateralAddress,
      ]),
  );
  if (submitted === undefined) {
    console.log("Read-only adapter preflight passed. No transaction was signed or sent.");
    return;
  }
  const { contract, deploymentTransaction } = submitted;
  // Hardhat Viem exposes the hash and predicted address once submission returns.
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
    throw new SafeAdapterDeploymentError(
      "The deployment receipt reports an unsuccessful transaction status.",
    );
  }

  currentStage = "runtime bytecode verification";
  await verifyLocalCTFAdapterRuntime(
    publicClient,
    contract.address,
    artifact.runtime,
    artifact.immutableReferences,
  );
  currentStage = "constructor address verification";
  const readAddress = async (functionName: "ctf" | "collateral") => {
    const data = encodeFunctionData({
      abi: adapterConfigurationAbi,
      functionName,
    });
    const result = await publicClient.request({
      method: "eth_call",
      params: [{ to: contract.address, data }, "latest"],
    });
    return decodeFunctionResult({
      abi: adapterConfigurationAbi,
      functionName,
      data: result as Hex,
    });
  };
  const [deployedCtfAddress, deployedCollateralAddress] = await Promise.all([
    readAddress("ctf"),
    readAddress("collateral"),
  ]);
  verifyAdapterConstructorAddresses(
    deployedCtfAddress,
    deployedCollateralAddress,
    ctfAddress,
    collateralAddress,
  );

  console.log(`LocalCTFAdapter address: ${contract.address}`);
  console.log(`Deployment transaction: ${deploymentTransaction.hash}`);
  console.log(`Sepolia explorer: https://sepolia.etherscan.io/address/${contract.address}`);
  console.log("Deployed runtime bytecode matches the compiled LocalCTFAdapter artifact.");
  console.log("Deployed CTF and collateral immutables match the preflight addresses.");
}

main().catch((error: unknown) => {
  for (const line of formatAdapterDeploymentFailure(
    currentStage,
    error,
    submittedDeployment,
  )) {
    console.error(line);
  }
  process.exitCode = 1;
});
