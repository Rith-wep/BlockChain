import { resolve } from "node:path";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { CONDITION_RECORD_DIRECTORY, loadConditionRecord } from "./lib/condition-inspector.js";
import { loadIntegrationArtifacts, loadRpcUrl, INTEGRATION_ADDRESSES } from "./lib/sepolia-integration-preflight.js";
import { SPLIT_QUESTION_ID, SPLIT_WALLET } from "./lib/sepolia-binary-split.js";
import { readResolutionContext, type ResolutionReader } from "./lib/sepolia-resolution-context.js";

async function main(): Promise<void> {
  const record = await loadConditionRecord(resolve(process.cwd(), CONDITION_RECORD_DIRECTORY, `${SPLIT_QUESTION_ID.slice(2)}.json`));
  const artifacts = await loadIntegrationArtifacts();
  const rpcUrl = await loadRpcUrl(process.env.SEPOLIA_RPC_URL);
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const reader: ResolutionReader = {
    getChainId: () => client.getChainId(),
    getCode: (address) => client.getCode({ address }),
    getAdapterCtf: () => client.readContract({ address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "ctf" } as never) as Promise<Address>,
    getAdapterCollateral: () => client.readContract({ address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "collateral" } as never) as Promise<Address>,
    getOfficialConditionId: (oracle, questionId) => client.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "getConditionId", args: [oracle, questionId, 2n] } as never) as Promise<Hex>,
    getOutcomeSlotCount: (conditionId) => client.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "getOutcomeSlotCount", args: [conditionId] } as never) as Promise<bigint>,
    getPayoutDenominator: (conditionId) => client.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "payoutDenominator", args: [conditionId] } as never) as Promise<bigint>,
    getPayoutNumerator: (conditionId, index) => client.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "payoutNumerators", args: [conditionId, index] } as never) as Promise<bigint>,
    getPositionIds: async (oracle, questionId) => {
      const value = await client.readContract({ address: INTEGRATION_ADDRESSES.adapter, abi: artifacts.adapter.abi, functionName: "getBinaryPositionIds", args: [oracle, questionId] } as never) as readonly [Hex, Hex, Hex, bigint, bigint];
      return { conditionId: value[0], yesPositionId: value[3], noPositionId: value[4] };
    },
    getCollateralBalance: (wallet) => client.readContract({ address: INTEGRATION_ADDRESSES.collateral, abi: artifacts.collateral.abi, functionName: "balanceOf", args: [wallet] } as never) as Promise<bigint>,
    getPositionBalance: (wallet, id) => client.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "balanceOf", args: [wallet, id] } as never) as Promise<bigint>,
    getOperatorApproval: (wallet, operator) => client.readContract({ address: INTEGRATION_ADDRESSES.ctf, abi: artifacts.ctf.abi, functionName: "isApprovedForAll", args: [wallet, operator] } as never) as Promise<boolean>,
  };
  const context = await readResolutionContext(SPLIT_WALLET, record, reader, {
    ctfRuntime: artifacts.ctf.runtime, collateralRuntime: artifacts.collateral.runtime,
    adapterRuntime: artifacts.adapter.runtime, adapterImmutableReferences: artifacts.adapter.immutableReferences,
  });
  console.log("Read-only Sepolia resolution preflight");
  console.log(`Network: chain ID 11155111`);
  console.log(`CTF: ${context.ctf}`);
  console.log(`Adapter: ${context.adapter}`);
  console.log(`Collateral: ${context.collateral}`);
  console.log(`Wallet/oracle: ${context.wallet} / ${context.oracle}`);
  console.log(`Question ID: ${context.questionId}`);
  console.log(`Condition ID: ${context.conditionId}`);
  console.log(`Prepared binary slots: ${context.outcomeSlotCount}`);
  console.log(`Payout denominator: ${context.payoutDenominator}; YES numerator: ${context.payoutNumerators[0]}; NO numerator: ${context.payoutNumerators[1]}`);
  console.log(`Status: ${context.payoutDenominator === 0n ? "unresolved" : "resolved"}`);
  console.log(`YES position ID: ${context.yesPositionId}; wallet balance: ${context.yesBalance}`);
  console.log(`NO position ID: ${context.noPositionId}; wallet balance: ${context.noBalance}`);
  console.log(`MOCK wallet balance (base units): ${context.collateralBalance}`);
  console.log(`Adapter ERC-1155 operator approval: ${context.operatorApproved}`);
  console.log("No wallet client or private key was loaded. No transaction was sent.");
}
main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : "unknown error";
  const message = error instanceof Error && error.name === "ResolutionContextError" ? error.message : `read-only RPC or record check failed (${name}); provider details were withheld.`;
  console.error(`Sepolia resolution preflight stopped: ${message}`);
  process.exitCode = 1;
});
