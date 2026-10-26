
const fs = require("node:fs");
const path = require("node:path");

const envPath = path.join(process.cwd(), ".env");

function readEnvValue(name) {
  if (!fs.existsSync(envPath)) return undefined;

  const line = fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((line) => new RegExp(`^\\s*${name}\\s*=`).test(line));

  if (!line) return undefined;

  return line
    .slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2");
}

const rpcUrl =
  process.env.SEPOLIA_RPC_URL || readEnvValue("SEPOLIA_RPC_URL");

if (!rpcUrl) {
  console.error("No Sepolia RPC URL found in environment or .env.");
  process.exit(1);
}

let parsedUrl;

try {
  parsedUrl = new URL(rpcUrl);
} catch {
  console.error("The RPC URL is not a valid URL.");
  process.exit(1);
}

console.log("Node version:", process.version);
console.log(
  "RPC source:",
  process.env.SEPOLIA_RPC_URL ? "environment variable" : ".env"
);
console.log("RPC protocol:", parsedUrl.protocol);
console.log("RPC host:", parsedUrl.hostname);
console.log("RPC path and credentials: [hidden]");

async function rpc(method) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: [],
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`HTTP status ${response.status}`);
  }

  const result = await response.json();

  if (result.error) {
    throw new Error(
      `JSON-RPC error ${result.error.code}: ${result.error.message}`
    );
  }

  return result.result;
}

async function main() {
  for (const method of ["eth_chainId", "eth_blockNumber"]) {
    try {
      console.log(`${method}:`, await rpc(method));
    } catch (error) {
      console.error(`${method} failed:`, error.name, error.message);
      process.exitCode = 1;
      return;
    }
  }
}

main().catch((error) => {
  console.error("Diagnostic failed:", error.name, error.message);
  process.exitCode = 1;
});
