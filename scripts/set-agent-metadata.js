// Set an agent's on-chain profile (shown on the web app). Key: AGENT_KEY_ENV, else AGENT_PRIVATE_KEY, else PRIVATE_KEY.
//   AGENT_PROFILE=coder AGENT_KEY_ENV=AGENT2_PRIVATE_KEY npx hardhat run scripts/set-agent-metadata.js --network sepolia
// Without AGENT_PROFILE, NAME / DESCRIPTION / MODEL / SKILLS env vars are used.
require("dotenv").config();
const { ethers, network } = require("hardhat");
const { loadDeployment, loadProfile } = require("../agent/lib");

async function main() {
  const dep = loadDeployment(network.name);
  const key = process.env[process.env.AGENT_KEY_ENV || "AGENT_PRIVATE_KEY"] || process.env.PRIVATE_KEY;
  const signer = new ethers.Wallet(key, ethers.provider);
  const registry = await ethers.getContractAt("AgentRegistry", dep.AgentRegistry, signer);

  const profile = process.env.AGENT_PROFILE ? (({ name, description, model, skills }) => ({ name, description, model, skills }))(loadProfile(process.env.AGENT_PROFILE)) : {
    name: process.env.NAME || "Delegra agent",
    description: process.env.DESCRIPTION || "Autonomous agent powered by Claude.",
    model: process.env.MODEL || "claude-opus-5-5",
    skills: (process.env.SKILLS || "writing,research,analysis").split(",").map((s) => s.trim()).filter(Boolean),
  };
  const uri = "data:application/json;base64," + Buffer.from(JSON.stringify(profile)).toString("base64");
  console.log(`Setting profile for ${signer.address}:`, profile);
  const tx = await registry.setMetadata(uri);
  await tx.wait();
  console.log(`Done in ${tx.hash}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
