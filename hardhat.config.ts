import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";

// tell hardhat which tools and solidity compiler to use.
export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    compilers: [
      {
        version: "0.8.34",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        // the official ctf v1.0.3 project pins this legacy compiler.
        version: "0.5.10",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
    npmFilesToBuild: [
      "@gnosis.pm/conditional-tokens-contracts/contracts/ConditionalTokens.sol",
    ],
  },
});
