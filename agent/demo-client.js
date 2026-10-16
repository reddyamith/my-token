// Delegra demo client: keeps the network visibly alive on testnet by posting one real task every
// INTERVAL_HOURS and approving delivered ones. Every task is a real on-chain job, done by a real
// agent; specs are prefixed "[demo]" so the web app can label them honestly.
//
//   node agent/demo-client.js
//
// Env (from .env): PRIVATE_KEY (client wallet; needs a little ETH; test USDC is minted as needed),
// SEPOLIA_RPC_URL, optional NETWORK (default sepolia), INTERVAL_HOURS (default 6),
// PAYMENT (USDC, default 5), BOND (DLGR, default 1000), POLL_SECONDS (default 60).
require("dotenv").config();
const { ethers } = require("ethers");
const { loadDeployment, loadAbi, encodeUri } = require("./lib");

const NETWORK = process.env.NETWORK || "sepolia";
const INTERVAL_MS = (Number(process.env.INTERVAL_HOURS) || 6) * 3600 * 1000;
const POLL_MS = (Number(process.env.POLL_SECONDS) || 60) * 1000;
const PAYMENT = ethers.parseUnits(process.env.PAYMENT || "5", 6);
const BOND = ethers.parseUnits(process.env.BOND || "1000", 18);
const Status = { Submitted: 2n };

const PROMPTS = [
  "Write a 3-sentence explanation of escrow for someone who has never used crypto.",
  "List 5 tasks a business could safely delegate to an AI agent today, one line each.",
  "Draft a 60-word product update announcing that a service now accepts USDC payments.",
  "Summarise in 4 bullet points why collateral makes a marketplace more trustworthy.",
  "Write a polite 3-sentence email declining a meeting and proposing an async update instead.",
  "Give 5 name ideas for a newsletter about AI agents, each with a one-line tagline.",
  "Explain in 100 words what a stablecoin is and why freelancers might prefer to be paid in one.",
  "Write a short FAQ (3 questions) for first-time users of an AI agent marketplace.",
  "Turn this into a tweet under 240 characters: AI agents can now post a bond and get paid on-chain when the client approves.",
  "List 6 common mistakes small businesses make when outsourcing writing work, one line each.",
];

async function main() {
  const dep = loadDeployment(NETWORK);
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com");
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
    if ((await usdc.balanceOf(wallet.address)) < PAYMENT) await (await usdc.mint(wallet.address, PAYMENT * 10n, await fees())).wait();
    if ((await usdc.allowance(wallet.address, dep.TaskEscrow)) < PAYMENT) await (await usdc.approve(dep.TaskEscrow, ethers.MaxUint256, await fees())).wait();
    const count = Number(await escrow.taskCount());
    const spec = `[demo] ${PROMPTS[count % PROMPTS.length]}`;
    const deadline = Math.floor(Date.now() / 1000) + 24 * 3600;
    const tx = await escrow.createTask(dep.USDC, PAYMENT, BOND, deadline, encodeUri(spec), ethers.ZeroAddress, await fees());
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
