// Delegra demo agent: watches the TaskEscrow for open tasks, accepts them, does the work with
// Claude, and submits the result on-chain so the client can approve and pay.
//
//   node agent/agent.js
//
// Env (from .env): AGENT_PRIVATE_KEY, else PRIVATE_KEY (agent wallet; must hold DLGR and a little ETH), SEPOLIA_RPC_URL,
// ANTHROPIC_API_KEY, optional NETWORK (default sepolia), POLL_SECONDS (default 15).
require("dotenv").config();
const { ethers } = require("ethers");
const Anthropic = require("@anthropic-ai/sdk");
const { loadDeployment, loadAbi, decodeUri, encodeUri } = require("./lib");

const NETWORK = process.env.NETWORK || "sepolia";
const POLL_MS = (Number(process.env.POLL_SECONDS) || 15) * 1000;
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const SYSTEM = `You are a Delegra agent: an autonomous worker hired on-chain to complete one task for a paying client.
Do exactly what the task asks, completely and carefully, in plain text or Markdown.
Return only the deliverable. No preamble, no questions back, no commentary about being an AI.`;

async function main() {
  const dep = loadDeployment(NETWORK);
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com");
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY || process.env.PRIVATE_KEY, provider);
  const escrow = new ethers.Contract(dep.TaskEscrow, loadAbi("TaskEscrow"), wallet);
  const registry = new ethers.Contract(dep.AgentRegistry, loadAbi("AgentRegistry"), wallet);
  const claude = new Anthropic();

  console.log(`Delegra agent ${wallet.address} on ${NETWORK}`);
  const me = await registry.getAgent(wallet.address);
  if (!me.active) throw new Error("This wallet is not an active agent. Run scripts/register-agent.js first.");
  console.log(`Active. Free bond: ${ethers.formatUnits(me.freeBond, 18)} DLGR, jobs done: ${me.jobsCompleted}`);

  const seen = new Set();
  const Status = { Open: 0n, Accepted: 1n };

  async function handle(id) {
    if (seen.has(id)) return;
    seen.add(id);
    const t = await escrow.getTask(id);
    const mine = t.agent.toLowerCase() === wallet.address.toLowerCase();
    if (t.status === Status.Accepted && mine) {
      // Accepted in an earlier run but never delivered (e.g. the process was stopped): resume.
      console.log(`\nTask #${id}: already accepted by me, resuming.`);
    } else {
      if (t.status !== Status.Open) return;
      if (t.agent !== ethers.ZeroAddress && !mine) return;
      const free = await registry.freeBondOf(wallet.address);
      if (free < t.bondRequired) {
        console.log(`Task #${id}: needs ${ethers.formatUnits(t.bondRequired, 18)} DLGR bond, I have ${ethers.formatUnits(free, 18)} free. Skipping.`);
        return;
      }
      console.log(`\nTask #${id}: ${ethers.formatUnits(t.payment, 6)} USDC, bond ${ethers.formatUnits(t.bondRequired, 18)} DLGR. Accepting...`);
      await (await escrow.acceptTask(id)).wait();
    }

    const spec = await decodeUri(t.specURI);
    console.log(`Spec: ${spec.slice(0, 200)}${spec.length > 200 ? "..." : ""}`);
    console.log(`Working with ${MODEL}...`);

    let result;
    if (process.env.MOCK_RESULT) {
      result = process.env.MOCK_RESULT; // offline testing without an API key
    } else {
      const response = await claude.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: "user", content: spec }],
      }).finalMessage();
      if (response.stop_reason === "refusal") {
        console.log(`Claude declined this task (${response.stop_details?.category ?? "unspecified"}). Leaving it accepted; the client can claim timeout.`);
        return;
      }
      result = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    }
    console.log(`Result (${result.length} chars). Submitting on-chain...`);

    const tx = await escrow.submitResult(id, encodeUri(result));
    await tx.wait();
    console.log(`Submitted task #${id} in ${tx.hash}. Waiting for the client to approve.`);
  }

  // Catch up on anything already open, then watch for new tasks.
  const count = await escrow.taskCount();
  for (let id = 1n; id <= count; id++) await handle(id).catch((e) => console.error(`Task #${id}:`, e.shortMessage || e.message));

  console.log(`\nWatching for new tasks every ${POLL_MS / 1000}s. Ctrl+C to stop.`);
  let last = count;
  setInterval(async () => {
    try {
      const now = await escrow.taskCount();
      for (let id = last + 1n; id <= now; id++) await handle(id).catch((e) => console.error(`Task #${id}:`, e.shortMessage || e.message));
      last = now;
    } catch (e) {
      console.error("poll error:", e.shortMessage || e.message);
    }
  }, POLL_MS);
}

main().catch((e) => { console.error(e); process.exit(1); });
