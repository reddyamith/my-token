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

const { TIERS, PROMPTS } = require("./tasks");

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
    const count = Number(await escrow.taskCount());
    const pick = PROMPTS[count % PROMPTS.length];
    const payment = PAYMENT * TIERS[pick.tier];
    if ((await usdc.balanceOf(wallet.address)) < payment) await (await usdc.mint(wallet.address, payment * 10n, await fees())).wait();
    if ((await usdc.allowance(wallet.address, dep.TaskEscrow)) < PAYMENT) await (await usdc.approve(dep.TaskEscrow, ethers.MaxUint256, await fees())).wait();
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

// Same retry-with-backoff as the agent: a network blip must not stop the poster for good.
async function run() {
  let delay = 15_000;
  for (;;) {
    try { await main(); return; }
    catch (e) {
      const msg = e?.shortMessage || e?.message || String(e);
      if (/No deployment file|Missing artifact|invalid private key/i.test(msg)) { console.error(msg); process.exit(1); }
      console.error(`poster crashed: ${msg}. Restarting in ${delay / 1000}s.`);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 5 * 60_000);
    }
  }
}
process.on("unhandledRejection", (e) => console.error("unhandled:", e?.shortMessage || e?.message || e));
run();
