// Delegra demo client: keeps the network visibly alive on testnet by posting one real task every
// INTERVAL_HOURS and approving delivered ones. Every task is a real on-chain job, done by a real
// agent. The web app shows tasks from the project wallet as posted by the "Delegra team".
//
//   node agent/demo-client.js
//
// Env (from .env): PRIVATE_KEY (client wallet; needs a little ETH; test USDC is minted as needed),
// SEPOLIA_RPC_URL, optional NETWORK (default sepolia), INTERVAL_HOURS (default 6),
// PAYMENT (USDC, default 5), BOND (DLGR, default 1000), POLL_SECONDS (default 60).
require("dotenv").config();
const { ethers } = require("ethers");
const { loadDeployment, loadAbi, encodeUri, makeProvider } = require("./lib");

const NETWORK = process.env.NETWORK || "sepolia";
const INTERVAL_MS = (Number(process.env.INTERVAL_HOURS) || 6) * 3600 * 1000;
const POLL_MS = (Number(process.env.POLL_SECONDS) || 60) * 1000;
const PAYMENT = ethers.parseUnits(process.env.PAYMENT || "5", 6);
const BOND = ethers.parseUnits(process.env.BOND || "1000", 18);
const Status = { Submitted: 2n };

// A mix of easy, medium and hard tasks, interleaved so the site shows range. Payment scales
// with difficulty (test USDC); PAYMENT env overrides the easy tier and the others scale from it.
const TIERS = { easy: 1n, medium: 3n, hard: 6n }; // multiples of PAYMENT
const PROMPTS = [
  { tier: "easy", spec: "Write a 3-sentence explanation of escrow for someone who has never used crypto." },
  { tier: "medium", spec: "Write a 400-word blog post titled 'Why AI agents need collateral', with an intro, three sections with headings, and a closing call to action. Plain, concrete language; no hype." },
  { tier: "hard", spec: "Write a Python script that reads a CSV of transactions (columns: date, address, amount_usdc, status), removes duplicate rows, flags addresses with more than 3 rejected tasks in any 7-day window, and prints a summary table. Include type hints, docstrings, and a usage example with sample data." },
  { tier: "easy", spec: "List 5 tasks a business could safely delegate to an AI agent today, one line each." },
  { tier: "medium", spec: "Compare escrow-based payment with invoice-then-pay for freelance work: a table with 6 criteria (speed, trust, dispute handling, fees, cross-border, automation), then a 120-word recommendation for a solo developer." },
  { tier: "hard", spec: "Design a dispute-resolution policy for an AI-agent marketplace: roles, evidence required, timelines, appeal path, and what happens to the agent's bond in each outcome. 600 to 800 words, structured with headings, written so a non-lawyer can follow it." },
  { tier: "easy", spec: "Draft a 60-word product update announcing that a service now accepts USDC payments." },
  { tier: "medium", spec: "Write a JavaScript function that validates an Ethereum address (checksum included, no libraries), with 8 unit tests in plain Node assert. Explain the checksum algorithm in 5 lines above the code." },
  { tier: "hard", spec: "Produce a go-to-market plan for a developer tool that lets AI agents get paid on-chain: target segments ranked, the first 90 days week by week, three channels with expected cost per signup, and the two metrics that decide whether to continue after 90 days. Under 900 words." },
  { tier: "easy", spec: "Explain in 100 words what a stablecoin is and why freelancers might prefer to be paid in one." },
  { tier: "medium", spec: "Write a SQL query (PostgreSQL) over tables tasks(id, client, agent, payment, status, created_at) and agents(address, bond, registered_at) that returns, per agent, completed task count, total earned, median payment and days since registration, sorted by total earned. Explain each clause briefly." },
  { tier: "hard", spec: "Review this Solidity pattern for an escrow release function and list every security issue with severity and a fix: function release(uint id) external { Task storage t = tasks[id]; require(msg.sender == t.client); token.transfer(t.agent, t.payment); t.status = Done; } Then rewrite it correctly with checks-effects-interactions, reentrancy protection and events." },
  { tier: "easy", spec: "Write a polite 3-sentence email declining a meeting and proposing an async update instead." },
  { tier: "medium", spec: "Write a 350-word onboarding guide for a first-time client of an AI agent marketplace: what to prepare, how to write a good task spec, how to review a delivery, when to reject. Use numbered steps." },
  { tier: "easy", spec: "Give 5 name ideas for a newsletter about AI agents, each with a one-line tagline." },
  { tier: "hard", spec: "Write a bash script that watches a JSON-RPC endpoint list, measures latency and block height for each every 30 seconds, marks an endpoint unhealthy if it lags the best height by more than 3 blocks or times out twice in a row, and writes the ranked healthy list to a file atomically. Include a shebang, set -euo pipefail, comments, and a short README section." },
  { tier: "easy", spec: "Turn this into a tweet under 240 characters: AI agents can now post a bond and get paid on-chain when the client approves." },
  { tier: "medium", spec: "Summarise the trade-offs of fixed-supply tokens versus inflationary tokens for a work marketplace in 300 words, ending with a one-paragraph position and the main risk of that position." },
];

async function main() {
  const dep = loadDeployment(NETWORK);
  const provider = makeProvider(NETWORK);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const escrow = new ethers.Contract(dep.TaskEscrow, loadAbi("TaskEscrow"), wallet);
  const usdc = new ethers.Contract(dep.USDC, loadAbi("MockUSDC"), wallet);
  console.log(`Delegra demo client ${wallet.address} on ${NETWORK}: one task every ${INTERVAL_MS / 3600000}h`);

  // Keep gas cheap on testnets: tiny priority fee, cap at 2x base fee.
  async function fees() {
    const block = await provider.getBlock("latest");
    const tip = ethers.parseUnits("0.01", "gwei");
    return { maxPriorityFeePerGas: tip, maxFeePerGas: block.baseFeePerGas * 2n + tip };
  }

  async function postTask() {
    const bal = await provider.getBalance(wallet.address);
    if (bal < ethers.parseEther("0.0005")) { console.log(`Low ETH (${ethers.formatEther(bal)}). Skipping this round; top up from a faucet.`); return; }
    const pick = PROMPTS[count % PROMPTS.length];
    const payment = PAYMENT * TIERS[pick.tier];
    if ((await usdc.balanceOf(wallet.address)) < payment) await (await usdc.mint(wallet.address, payment * 10n, await fees())).wait();
    if ((await usdc.allowance(wallet.address, dep.TaskEscrow)) < PAYMENT) await (await usdc.approve(dep.TaskEscrow, ethers.MaxUint256, await fees())).wait();
    const count = Number(await escrow.taskCount());
    const spec = pick.spec;
    const deadline = Math.floor(Date.now() / 1000) + 24 * 3600;
    const tx = await escrow.createTask(dep.USDC, payment, BOND, deadline, encodeUri(spec), ethers.ZeroAddress, await fees());
    await tx.wait();
    console.log(`${new Date().toISOString()} posted task #${count + 1}: ${spec} (${tx.hash})`);
  }

  async function approveDelivered() {
    const count = Number(await escrow.taskCount());
    for (let id = Math.max(1, count - 20); id <= count; id++) {
      const t = await escrow.getTask(id);
      if (t.status !== Status.Submitted || t.client.toLowerCase() !== wallet.address.toLowerCase()) continue;
      const tx = await escrow.approve(id, await fees());
      await tx.wait();
      console.log(`${new Date().toISOString()} approved task #${id}, agent paid ${ethers.formatUnits(t.payment - t.payment / 100n, 6)} USDC (${tx.hash})`);
    }
  }

  let nextPost = 0;
  for (;;) {
    try {
      if (Date.now() >= nextPost) { await postTask(); nextPost = Date.now() + INTERVAL_MS; }
      await approveDelivered();
    } catch (e) { console.error("error:", e.shortMessage || e.message); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
