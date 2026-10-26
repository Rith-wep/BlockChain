import { connectToSepoliaForDeployment } from "./lib/sepolia-guard.js";
import {
  checkCtfDeploymentCost,
  loadOfficialCtfBytecode,
  SafePreflightError,
} from "./lib/ctf-deployment-check.js";
import { formatSubmittedDeploymentDetails } from "./lib/deployment-failure-details.js";

let submittedDeployment:
  | { transactionHash: string; contractAddress: string }
  | undefined;

async function main() {
  const { viem, publicClient, walletClient } =
    await connectToSepoliaForDeployment();

  console.log(
    "Deploying ConditionalTokens from the pinned @gnosis.pm/conditional-tokens-contracts 1.0.3 package.",
  );
  console.log("This official contract has no constructor arguments.");
  console.log(
    "Its artifact is compiled with Solidity 0.5.10, optimizer enabled (200 runs), and EVM target petersburg, separately from the 0.8.34 project contracts.",
  );

  const bytecode = await loadOfficialCtfBytecode();
  await checkCtfDeploymentCost(
    publicClient,
    walletClient.account.address,
    bytecode.creation,
  );

  const { contract, deploymentTransaction } =
    await viem.sendDeploymentTransaction("ConditionalTokens");
  submittedDeployment = {
    transactionHash: deploymentTransaction.hash,
    contractAddress: contract.address,
  };
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
  if (deployedCode.toLowerCase() !== bytecode.runtime.toLowerCase()) {
    throw new Error(
      `Deployed CTF runtime bytecode differs from the local pinned artifact at ${contract.address}.`,
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
  // Provider errors can echo credential-bearing RPC URLs; never print raw details.
  if (error instanceof SafePreflightError) {
    console.error(error.safeDiagnostic);
    for (const detail of formatSubmittedDeploymentDetails(submittedDeployment)) {
      console.error(detail);
    }
    process.exitCode = 1;
    return;
  }

  console.error(
    "CTF deployment stopped. Review the redacted error, run the read-only preflight, and check the Sepolia RPC, chain ID, artifact, and test-ETH balance.",
  );
  for (const detail of formatSubmittedDeploymentDetails(submittedDeployment)) {
    console.error(detail);
  }
  process.exitCode = 1;
});
