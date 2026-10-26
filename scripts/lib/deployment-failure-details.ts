type SubmittedDeployment = {
  transactionHash: string;
  contractAddress: string;
};

// report public deployment identifiers after submission without exposing raw errors.
export function formatSubmittedDeploymentDetails(
  deployment: SubmittedDeployment | undefined,
): string[] {
  if (deployment === undefined) return [];

  const details: string[] = [];
  if (/^0x[0-9a-fA-F]{64}$/.test(deployment.transactionHash)) {
    details.push(`Deployment transaction hash: ${deployment.transactionHash}`);
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(deployment.contractAddress)) {
    details.push(
      `Contract address (predicted; receipt and code checks may be incomplete): ${deployment.contractAddress}`,
    );
  }
  return details;
}
