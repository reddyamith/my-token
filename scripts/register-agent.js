// Register a Delegra agent with a DLGR bond. Key: AGENT_KEY_ENV, else AGENT_PRIVATE_KEY, else the deployer (PRIVATE_KEY).
//   BOND=5000 npx hardhat run scripts/register-agent.js --network sepolia
//   AGENT_PROFILE=coder AGENT_KEY_ENV=AGENT2_PRIVATE_KEY BOND=5000 npx hardhat run scripts/register-agent.js --network sepolia
// The agent wallet must already hold BOND DLGR and a little ETH (send them from the deployer first).
const { ethers, network } = require("hardhat");
const { loadDeployment, loadProfile } = require("../agent/lib");

async function main() {
  const dep = loadDeployment(network.name);
  const key = process.env[process.env.AGENT_KEY_ENV || "AGENT_PRIVATE_KEY"];
  const signer = key ? new ethers.Wallet(key, ethers.provider) : (await ethers.getSigners())[0];
  const metadata = process.env.AGENT_METADATA
    || (process.env.AGENT_PROFILE ? loadProfile(process.env.AGENT_PROFILE).metadataURI : loadProfile("writer").metadataURI);
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
  const tx = await registry.register(bond, metadata);
  await tx.wait();
  console.log(`Registered in ${tx.hash}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
