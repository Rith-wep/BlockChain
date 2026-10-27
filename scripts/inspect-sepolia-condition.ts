import { randomUUID } from "node:crypto";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import {
  createQuestionId,
  CONDITION_INSPECTOR_CTF,
  CONDITION_INSPECTOR_ORACLE,
  inspectBinaryCondition,
  saveConditionRecord,
  type BinaryConditionRecord,
} from "./lib/condition-inspector.js";
import {
  createArtifactReader,
  loadIntegrationArtifacts,
  loadRpcUrl,
  type IntegrationReader,
} from "./lib/sepolia-integration-preflight.js";

async function main(): Promise<void> {
  const description = process.argv.slice(2).join(" ").trim();
  if (description === "") {
    throw new Error('Provide an explicit question description, e.g. npm.cmd run ctf:inspect-condition -- "Will the stated event occur?"');
  }

  // The nonce is generated locally and included in the hash input to make IDs unique.
  const nonce = randomUUID();
  const questionId = createQuestionId(description, nonce);
  const rpcUrl = await loadRpcUrl(process.env.SEPOLIA_RPC_URL);
  const artifacts = await loadIntegrationArtifacts();
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  const chainId = await publicClient.getChainId();
  if (chainId !== 11155111) throw new Error(`RPC chain ID is ${chainId}; expected Sepolia 11155111.`);

  // This reader is backed by a public client without an account or wallet client.
  const reader: IntegrationReader = {
    getChainId: () => publicClient.getChainId(),
    getCode: ({ address }) => publicClient.getCode({ address }),
    readContract: async <T = unknown>({ address, abi, functionName, args }): Promise<T> => {
      const read = createArtifactReader({ abi, runtime: "0x00", immutableReferences: [] });
      const callReader = publicClient as unknown as Parameters<typeof read>[0];
      return read<T>(callReader, address, functionName, args);
    },
  };
  const status = await inspectBinaryCondition(
    reader,
    artifacts.ctf.abi,
    CONDITION_INSPECTOR_ORACLE,
    questionId,
  );

  const record: BinaryConditionRecord = {
    network: "sepolia",
    chainId: 11155111,
    ctfAddress: CONDITION_INSPECTOR_CTF,
    description,
    nonce,
    questionId,
    oracle: CONDITION_INSPECTOR_ORACLE,
    conditionId: status.conditionId,
    outcomeSlotCount: status.outcomeSlotCount.toString(),
    payoutDenominator: status.payoutDenominator.toString(),
    prepared: status.prepared,
    resolved: status.resolved,
  };
  const recordPath = await saveConditionRecord(record);

  console.log(`Question description: ${description}`);
  console.log(`Nonce: ${nonce}`);
  console.log(`Question ID: ${questionId}`);
  console.log(`Oracle: ${CONDITION_INSPECTOR_ORACLE}`);
  console.log(`Condition ID: ${status.conditionId}`);
  console.log(`Outcome slot count: ${status.outcomeSlotCount}`);
  console.log(`Prepared binary condition: ${status.prepared}`);
  console.log(`Payout denominator: ${status.payoutDenominator}`);
  console.log(`Resolved: ${status.resolved}`);
  console.log(`Record saved: ${recordPath}`);
  console.log("Read-only inspection complete. No condition was prepared and no transaction was sent.");
}

main().catch((error: unknown) => {
  if (error instanceof Error && error.name === "SafeIntegrationPreflightError") {
    console.error(`Condition inspection stopped: ${"diagnostic" in error ? String(error.diagnostic) : error.message}`);
  } else if (error instanceof Error && /Provide an explicit|RPC chain ID|record for this question ID|Could not save/.test(error.message)) {
    console.error(`Condition inspection stopped: ${error.message}`);
  } else {
    const name = error instanceof Error ? error.name : "unknown";
    console.error(`Condition inspection stopped (unexpected ${name}). Raw RPC details were withheld.`);
  }
  process.exitCode = 1;
});
