// Post a task to the TaskEscrow as a client, paying in (Mock)USDC.
//   TASK="Write a haiku about Ethereum" PAYMENT=25 BOND=2000 npx hardhat run scripts/post-task.js --network sepolia
// Env: TASK (text), PAYMENT (USDC, default 10), BOND (DLGR, default 1000), HOURS (deadline, default 24), AGENT (optional address)
const { ethers, network } = require("hardhat");
const { loadDeployment, encodeUri } = require("../agent/lib");

async function main() {
  const dep = loadDeployment(network.name);
  const [signer] = await ethers.getSigners();
  const task = process.env.TASK || "Write a 3-sentence pitch for a token that makes AI agents trustworthy.";
  const payment = ethers.parseUnits(process.env.PAYMENT || "10", 6);
  const bond = ethers.parseUnits(process.env.BOND || "1000", 18);
  const deadline = Math.floor(Date.now() / 1000) + (Number(process.env.HOURS) || 24) * 3600;
  const agent = process.env.AGENT || ethers.ZeroAddress;

  const usdc = await ethers.getContractAt("MockUSDC", dep.USDC, signer);
  const escrow = await ethers.getContractAt("TaskEscrow", dep.TaskEscrow, signer);

  const bal = await usdc.balanceOf(signer.address);
  if (bal < payment) {
    console.log(`Minting ${ethers.formatUnits(payment, 6)} test USDC to ${signer.address}`);
    await (await usdc.mint(signer.address, payment)).wait();
  }
  await (await usdc.approve(dep.TaskEscrow, payment)).wait();

  console.log(`Posting task: "${task}" for ${ethers.formatUnits(payment, 6)} USDC, bond ${ethers.formatUnits(bond, 18)} DLGR`);
  const tx = await escrow.createTask(dep.USDC, payment, bond, deadline, encodeUri(task), agent);
  await tx.wait();
  const id = await escrow.taskCount();
  console.log(`Task #${id} created in ${tx.hash}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
