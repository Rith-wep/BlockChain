import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatSubmittedDeploymentDetails } from "../../scripts/lib/deployment-failure-details.js";

describe("submitted CTF deployment failure details", () => {
  it("preserves a valid transaction hash and predicted contract address", () => {
    const transactionHash = `0x${"ab".repeat(32)}`;
    const contractAddress = `0x${"cd".repeat(20)}`;

    assert.deepEqual(
      formatSubmittedDeploymentDetails({ transactionHash, contractAddress }),
      [
        `Deployment transaction hash: ${transactionHash}`,
        `Contract address (predicted; receipt and code checks may be incomplete): ${contractAddress}`,
      ],
    );
  });

  it("omits malformed identifiers instead of logging arbitrary provider text", () => {
    const secretText = "https://rpc.example/private-api-token";
    const details = formatSubmittedDeploymentDetails({
      transactionHash: secretText,
      contractAddress: secretText,
    });

    assert.deepEqual(details, []);
    assert.doesNotMatch(details.join(" "), /private-api-token/);
  });

  it("returns no details before a deployment transaction is submitted", () => {
    assert.deepEqual(formatSubmittedDeploymentDetails(undefined), []);
  });
});
