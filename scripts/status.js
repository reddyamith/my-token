// One-command health check for the Delegra testnet deployment. Read-only; prints no secrets.
//   node scripts/status.js            (NETWORK=sepolia by default)
// Shows: process state of the agent and task poster, wallet gas, the last few tasks, and the agents.
require("dotenv").config();
const { execSync } = require("child_process");
const { ethers } = require("ethers");
const { loadDeployment, loadAbi, makeProvider, decodeUri } = require("../agent/lib");

const NETWORK = process.env.NETWORK || "sepolia";
const STATUS = ["Open", "Accepted", "Submitted", "Completed", "Cancelled", "Failed", "Disputed"];
const LOW_PROJECT = ethers.parseEther("0.008");
const LOW_AGENT = ethers.parseEther("0.002");

function pids(needle) {
  // ps instead of pgrep -f, which would match its own command line (and this script's).
  try {
    return execSync("ps -eo pid=,args=", { stdio: ["ignore", "pipe", "ignore"] }).toString().split("\n")
      .map((l) => l.trim()).filter((l) => l.includes(needle) && l.includes("node") && !l.includes("status.js"))
      .map((l) => l.split(/\s+/)[0]).filter((pid) => Number(pid) !== process.pid && Number(pid) !== process.ppid);
  } catch { return []; }
}

async function main() {
  const dep = loadDeployment(NETWORK);
  const provider = makeProvider(NETWORK);
  const escrow = new ethers.Contract(dep.TaskEscrow, loadAbi("TaskEscrow"), provider);
  const registry = new ethers.Contract(dep.AgentRegistry, loadAbi("AgentRegistry"), provider);

  const agentPids = pids("agent/agent.js"), posterPids = pids("agent/demo-client.js");
  console.log(`agent.js:        ${agentPids.length ? "running (pid " + agentPids.join(", ") + ")" : "NOT RUNNING"}`);
  console.log(`demo-client.js:  ${posterPids.length ? "running (pid " + posterPids.join(", ") + ")" : "NOT RUNNING"}`);

  const wallets = [["project", dep.deployer]];
  if (process.env.AGENT_PRIVATE_KEY) wallets.push(["agent", new ethers.Wallet(process.env.AGENT_PRIVATE_KEY).address]);
  if (process.env.AGENT2_PRIVATE_KEY) wallets.push(["agent2", new ethers.Wallet(process.env.AGENT2_PRIVATE_KEY).address]);
  let warnings = [];
  for (const [name, addr] of wallets) {
    const bal = await provider.getBalance(addr);
    const low = name === "project" ? bal < LOW_PROJECT : bal < LOW_AGENT;
    console.log(`${name.padEnd(8)} ${addr}  ${ethers.formatEther(bal)} ETH${low ? "  <-- LOW" : ""}`);
    if (low) warnings.push(`${name} wallet low on gas`);
  }

  const count = Number(await escrow.taskCount());
  console.log(`\ntasks: ${count}`);
  for (let id = Math.max(1, count - 4); id <= count; id++) {
    const t = await escrow.getTask(id);
    const spec = (await decodeUri(t.specURI)).replace(/\s+/g, " ").slice(0, 70);
    console.log(`  #${id} ${STATUS[Number(t.status)].padEnd(9)} ${ethers.formatUnits(t.payment, 6)} USDC  ${spec}`);
    if (Number(t.status) === 2) warnings.push(`task #${id} is Submitted and waiting for approval`);
    if (Number(t.status) === 0 && agentPids.length === 0) warnings.push(`task #${id} is Open with no agent running`);
  }

  const from = dep.startBlock || 0, latest = await provider.getBlockNumber();
  const agents = new Set();
  for (let a = from; a <= latest; a += 50000) {
    const evs = await registry.queryFilter(registry.filters.AgentRegistered(), a, Math.min(a + 49999, latest)).catch(() => []);
    for (const e of evs) agents.add(e.args[0]);
  }
  console.log(`\nagents: ${agents.size}`);
  for (const a of agents) {
    const info = await registry.getAgent(a);
    let name = "";
    try { const t = await decodeUri(info.metadataURI); name = t.trim().startsWith("{") ? JSON.parse(t).name : t.slice(0, 40); } catch {}
    console.log(`  ${a}  ${info.active ? "active" : "inactive"}  bond ${ethers.formatUnits(info.freeBond, 18)} free  jobs ${info.jobsCompleted}  ${name}`);
  }

  console.log(warnings.length ? `\nWARNINGS:\n  - ${warnings.join("\n  - ")}` : "\nall good");
  provider.destroy?.();
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
