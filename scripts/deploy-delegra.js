// Deploys the Delegra stack: DLGR token, AgentRegistry, TaskEscrow (+ MockUSDC on testnets).
//   npx hardhat run scripts/deploy-delegra.js --network sepolia
// Env overrides: USDC_ADDRESS (use a real USDC instead of MockUSDC), TREASURY, MIN_BOND (whole DLGR)
const { ethers, network } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer: set PRIVATE_KEY and the RPC URL in .env");
  console.log(`Deploying Delegra to ${network.name} from ${deployer.address}`);

  const treasury = process.env.TREASURY || deployer.address;
  const minBond = ethers.parseUnits(process.env.MIN_BOND || "1000", 18);

  const dlgr = await ethers.deployContract("DelegraToken", [deployer.address]);
  await dlgr.waitForDeployment();
  console.log(`DelegraToken (DLGR): ${await dlgr.getAddress()}`);

  let usdcAddress = process.env.USDC_ADDRESS;
  if (!usdcAddress) {
    const usdc = await ethers.deployContract("MockUSDC");
    await usdc.waitForDeployment();
    usdcAddress = await usdc.getAddress();
    console.log(`MockUSDC (test only):  ${usdcAddress}`);
  }

  const registry = await ethers.deployContract("AgentRegistry", [await dlgr.getAddress(), minBond, deployer.address]);
  await registry.waitForDeployment();
  console.log(`AgentRegistry:         ${await registry.getAddress()}`);

  const escrow = await ethers.deployContract("TaskEscrow", [await registry.getAddress(), treasury, deployer.address]);
  await escrow.waitForDeployment();
  console.log(`TaskEscrow:            ${await escrow.getAddress()}`);

  await (await registry.setEscrow(await escrow.getAddress())).wait();
  await (await escrow.setPaymentTokenAllowed(usdcAddress, true)).wait();
  console.log("Wired: registry.escrow set, USDC allowed as payment token");

  const out = {
    network: network.name,
    deployer: deployer.address,
    startBlock: await ethers.provider.getBlockNumber(),
    DelegraToken: await dlgr.getAddress(),
    USDC: usdcAddress,
    AgentRegistry: await registry.getAddress(),
    TaskEscrow: await escrow.getAddress(),
    minBond: minBond.toString(),
    treasury,
  };
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(`deployments/delegra-${network.name}.json`, JSON.stringify(out, null, 2));
  console.log(`Saved deployments/delegra-${network.name}.json`);

  if (!["hardhat", "localhost"].includes(network.name)) {
    console.log("\nVerify with:");
    console.log(`  npx hardhat verify --network ${network.name} ${out.DelegraToken} ${deployer.address}`);
    if (!process.env.USDC_ADDRESS) console.log(`  npx hardhat verify --network ${network.name} ${usdcAddress}`);
    console.log(`  npx hardhat verify --network ${network.name} ${out.AgentRegistry} ${out.DelegraToken} ${minBond} ${deployer.address}`);
    console.log(`  npx hardhat verify --network ${network.name} ${out.TaskEscrow} ${out.AgentRegistry} ${treasury} ${deployer.address}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
