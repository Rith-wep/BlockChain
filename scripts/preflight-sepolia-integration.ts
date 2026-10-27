import { createPublicClient, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import {
  createArtifactReader,
  loadIntegrationArtifacts,
  loadRpcUrl,
  parseIntegrationOptions,
  runIntegrationPreflight,
  SafeIntegrationPreflightError,
  type IntegrationReader,
} from "./lib/sepolia-integration-preflight.js";

async function main(): Promise<void> {
  const rpcUrl = await loadRpcUrl(process.env.SEPOLIA_RPC_URL);
  const options = parseIntegrationOptions(process.env);
  const artifacts = await loadIntegrationArtifacts();

  // Deliberately create a public client with no account or wallet client.
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const reader: IntegrationReader = {
    getChainId: () => publicClient.getChainId(),
    getCode: ({ address }) => publicClient.getCode({ address }),
    readContract: async <T = unknown>({ address, abi, functionName, args }): Promise<T> => {
      const read = createArtifactReader({ abi, runtime: "0x00", immutableReferences: [] });
      const callReader = publicClient as unknown as Parameters<typeof read>[0];
      return read<T>(callReader, address as Address, functionName, args);
    },
  };

  await runIntegrationPreflight(reader, artifacts, options);
}

main().catch((error: unknown) => {
  if (error instanceof SafeIntegrationPreflightError) {
    console.error(`Sepolia integration preflight stopped: ${error.diagnostic}`);
  } else {
    const name = typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : "unknown";
    console.error(`Sepolia integration preflight stopped (unexpected ${name}). Raw provider details were withheld.`);
  }
  process.exitCode = 1;
});
