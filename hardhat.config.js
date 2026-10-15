require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { SEPOLIA_RPC_URL, BASE_SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: { version: "0.8.28", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
  networks: {
    hardhat: {},
    sepolia: {
      url: SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    baseSepolia: {
      url: BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  etherscan: { apiKey: ETHERSCAN_API_KEY || "" },
};

// Fallback: use the npm solc build when the compiler binary list can't be downloaded.
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === "0.8.28") {
    return { compilerPath: require.resolve("solc/soljson.js"), isSolcJs: true, version: "0.8.28", longVersion: "0.8.28+commit.7893614a" };
  }
  return runSuper();
});
