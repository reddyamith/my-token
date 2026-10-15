const { ethers, network } = require("hardhat");

// Token parameters: override via env or edit here.
const NAME = process.env.TOKEN_NAME || "MyToken";
const SYMBOL = process.env.TOKEN_SYMBOL || "MTK";
const INITIAL_SUPPLY = ethers.parseUnits(process.env.TOKEN_SUPPLY || "100000000", 18); // 100M
const CAP = ethers.parseUnits(process.env.TOKEN_CAP || "1000000000", 18); // 1B

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying ${NAME} (${SYMBOL}) to ${network.name} from ${deployer.address}`);

  const token = await ethers.deployContract("MyToken", [NAME, SYMBOL, INITIAL_SUPPLY, CAP, deployer.address]);
  await token.waitForDeployment();

  console.log(`MyToken deployed at: ${await token.getAddress()}`);
  console.log(`Initial supply: ${ethers.formatUnits(await token.totalSupply(), 18)} ${SYMBOL}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
