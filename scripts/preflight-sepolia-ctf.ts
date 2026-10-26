import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { loadLocalEnv } from "./lib/load-local-env.js";
import {
  checkCtfDeploymentCost,
  loadOfficialCtfBytecode,
  SafePreflightError,
} from "./lib/ctf-deployment-check.js";

const REQUIRED_CONFIRMATION = "I_UNDERSTAND_SEPOLIA_TESTNET_ONLY";
const EXPECTED_CHAIN_ID = 11155111;

loadLocalEnv();

let currentStage = "environment validation";

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
  const confirmation = process.env.CONFIRM_SEPOLIA_ONLY;
  const missing = [
    ["SEPOLIA_RPC_URL", rpcUrl],
    ["SEPOLIA_PRIVATE_KEY", privateKey],
    ["CONFIRM_SEPOLIA_ONLY", confirmation],
  ]
    .filter(([, value]) => value === undefined || value.trim() === "")
    .map(([name]) => name);

  if (missing.length > 0) {
    console.error(`Missing required process environment variable(s): ${missing.join(", ")}`);
    console.error("No credentials were printed or written.");
    process.exitCode = 1;
    return;
  }
  currentStage = "Sepolia confirmation check";
  if (confirmation !== REQUIRED_CONFIRMATION) {
    throw new Error(
      "CONFIRM_SEPOLIA_ONLY does not match the required Sepolia-only confirmation phrase.",
    );
  }
  currentStage = "private-key format check";
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey!)) {
    throw new Error("SEPOLIA_PRIVATE_KEY must be a 32-byte hexadecimal key.");
  }
  currentStage = "RPC URL format check";
  if (!/^https?:\/\//i.test(rpcUrl!)) {
    throw new Error("SEPOLIA_RPC_URL must be an HTTP or HTTPS endpoint.");
  }

  currentStage = "local wallet address derivation";
  const account = privateKeyToAccount(privateKey as Hex);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  currentStage = "Sepolia RPC chain-ID check";
  const chainId = await publicClient.getChainId();
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `RPC chain ID is ${chainId}; refusing preflight because Sepolia is ${EXPECTED_CHAIN_ID}.`,
    );
  }

  console.log("Read-only Sepolia CTF deployment preflight");
  console.log(`Verified chain ID: ${chainId} (Sepolia)`);
  console.log(`Deployer address: ${account.address}`);
  console.log("Private key: loaded in memory only; never displayed or used to sign.");

  currentStage = "local official CTF artifact validation";
  const bytecode = await loadOfficialCtfBytecode();
  currentStage = "read-only gas and balance estimate";
  await checkCtfDeploymentCost(publicClient, account.address, bytecode.creation);
  console.log("Preflight passed. No transaction was signed or sent.");
}

main().catch((error: unknown) => {
  // Do not print RPC/client exceptions because they can contain a credential-bearing URL.
  if (error instanceof SafePreflightError) {
    console.error(`Preflight stopped during ${currentStage}: ${error.safeDiagnostic}`);
    process.exitCode = 1;
    return;
  }

  console.error(
    `Preflight stopped during ${currentStage}. Details are redacted to protect credentials; check the relevant input or RPC availability.`,
  );
  process.exitCode = 1;
});
