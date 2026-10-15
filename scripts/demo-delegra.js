// End-to-end demo of the Delegra flow on the in-process Hardhat chain:
// an agent bonds DLGR, a client posts a USDC task, the agent delivers, the client approves.
//   npx hardhat run scripts/demo-delegra.js
const { ethers } = require("hardhat");

const DLGR = (n) => ethers.parseUnits(String(n), 18);
const USDC = (n) => ethers.parseUnits(String(n), 6);
const fmt = (v, d) => ethers.formatUnits(v, d);

async function main() {
  const [deployer, agentOp, clientOp] = await ethers.getSigners();

  const dlgr = await ethers.deployContract("DelegraToken", [deployer.address]);
  const usdc = await ethers.deployContract("MockUSDC");
  const registry = await ethers.deployContract("AgentRegistry", [await dlgr.getAddress(), DLGR(1000), deployer.address]);
  const escrow = await ethers.deployContract("TaskEscrow", [await registry.getAddress(), deployer.address, deployer.address]);
  await registry.setEscrow(await escrow.getAddress());
  await escrow.setPaymentTokenAllowed(await usdc.getAddress(), true);

  await dlgr.transfer(agentOp.address, DLGR(5000));
  await usdc.mint(clientOp.address, USDC(250));
  console.log("1. Agent bonds 5,000 DLGR and registers");
  await dlgr.connect(agentOp).approve(await registry.getAddress(), DLGR(5000));
  await registry.connect(agentOp).register(DLGR(5000), "ipfs://QmAgentProfile");

  console.log("2. Client posts a task: 'Summarise 50 earnings calls' for 250 USDC, requiring a 2,000 DLGR bond");
  await usdc.connect(clientOp).approve(await escrow.getAddress(), USDC(250));
  const deadline = Math.floor(Date.now() / 1000) + 86400;
  await escrow.connect(clientOp).createTask(await usdc.getAddress(), USDC(250), DLGR(2000), deadline, "ipfs://QmTaskSpec", ethers.ZeroAddress);
  const id = await escrow.taskCount();

  console.log("3. Agent accepts (bond locked), does the work, submits the result");
  await escrow.connect(agentOp).acceptTask(id);
  await escrow.connect(agentOp).submitResult(id, "ipfs://QmSummaries");

  console.log("4. Client approves: agent paid, 1% fee to treasury, bond released");
  await escrow.connect(clientOp).approve(id);

  const a = await registry.getAgent(agentOp.address);
  console.log(`\nAgent USDC balance: ${fmt(await usdc.balanceOf(agentOp.address), 6)} (247.5 = 250 minus 1% fee)`);
  console.log(`Treasury USDC:      ${fmt(await usdc.balanceOf(deployer.address), 6)}`);
  console.log(`Agent free bond:    ${fmt(a.freeBond, 18)} DLGR, jobs completed: ${a.jobsCompleted}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
