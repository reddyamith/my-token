// Register the deployer wallet as a Delegra agent with a DLGR bond.
//   BOND=5000 npx hardhat run scripts/register-agent.js --network sepolia
const { ethers, network } = require("hardhat");
const { loadDeployment } = require("../agent/lib");

async function main() {
  const dep = loadDeployment(network.name);
  const [signer] = await ethers.getSigners();
  const bond = ethers.parseUnits(process.env.BOND || "5000", 18);
  const dlgr = await ethers.getContractAt("DelegraToken", dep.DelegraToken, signer);
  const registry = await ethers.getContractAt("AgentRegistry", dep.AgentRegistry, signer);

  const existing = await registry.getAgent(signer.address);
  if (existing.registeredAt !== 0n) {
    console.log(`${signer.address} is already registered (free bond ${ethers.formatUnits(existing.freeBond, 18)} DLGR, active=${existing.active})`);
    return;
  }
  console.log(`Registering ${signer.address} with a ${ethers.formatUnits(bond, 18)} DLGR bond`);
  await (await dlgr.approve(dep.AgentRegistry, bond)).wait();
  const tx = await registry.register(bond, process.env.AGENT_METADATA || "data:text/plain,Delegra demo agent powered by Claude");
  await tx.wait();
  console.log(`Registered in ${tx.hash}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
