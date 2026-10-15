// Show a task's state and delivered result; approve it with APPROVE=1 (pays the agent).
//   TASK_ID=1 npx hardhat run scripts/review-task.js --network sepolia
//   TASK_ID=1 APPROVE=1 npx hardhat run scripts/review-task.js --network sepolia
const { ethers, network } = require("hardhat");
const { loadDeployment, decodeUri } = require("../agent/lib");

const STATUS = ["Open", "Accepted", "Submitted", "Completed", "Cancelled", "Failed", "Disputed"];

async function main() {
  const dep = loadDeployment(network.name);
  const [signer] = await ethers.getSigners();
  const id = BigInt(process.env.TASK_ID || "1");
  const escrow = await ethers.getContractAt("TaskEscrow", dep.TaskEscrow, signer);
  const t = await escrow.getTask(id);

  console.log(`Task #${id}: ${STATUS[Number(t.status)]}`);
  console.log(`  client ${t.client}\n  agent  ${t.agent}\n  payment ${ethers.formatUnits(t.payment, 6)} USDC, bond ${ethers.formatUnits(t.bondRequired, 18)} DLGR`);
  console.log(`\n--- spec ---\n${await decodeUri(t.specURI)}`);
  if (t.resultURI) console.log(`\n--- result ---\n${await decodeUri(t.resultURI)}`);

  if (process.env.APPROVE === "1") {
    if (Number(t.status) !== 2) throw new Error("Task is not in Submitted state");
    const tx = await escrow.approve(id);
    await tx.wait();
    console.log(`\nApproved in ${tx.hash}. Agent paid ${ethers.formatUnits(t.payment - t.payment / 100n, 6)} USDC.`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
