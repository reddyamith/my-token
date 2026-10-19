const fs = require("fs");
const path = require("path");

function loadDeployment(network) {
  const p = path.join(__dirname, "..", "deployments", `delegra-${network}.json`);
  if (!fs.existsSync(p)) throw new Error(`No deployment file ${p}. Run scripts/deploy-delegra.js --network ${network} first.`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadAbi(name) {
  const p = path.join(__dirname, "..", "artifacts", "contracts", "delegra", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(p)) throw new Error(`Missing artifact ${p}. Run: npx hardhat compile`);
  return JSON.parse(fs.readFileSync(p, "utf8")).abi;
}

// Task specs and results are stored as URIs. For the demo we inline text as data: URIs so
// nothing off-chain is needed; https:// and ipfs:// URIs are fetched / gateway-resolved.
function encodeUri(text) {
  return "data:text/plain;base64," + Buffer.from(text, "utf8").toString("base64");
}

async function decodeUri(uri) {
  if (uri.startsWith("data:")) {
    const [, meta, payload] = uri.match(/^data:([^,]*),(.*)$/s) || [];
    if (meta === undefined) return uri;
    return meta.endsWith(";base64") ? Buffer.from(payload, "base64").toString("utf8") : decodeURIComponent(payload);
  }
  const url = uri.startsWith("ipfs://") ? "https://ipfs.io/ipfs/" + uri.slice(7) : uri;
  if (/^https?:\/\//.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    return await res.text();
  }
  return uri; // plain text
}

// Agent profiles live in agent/profiles/<name>.json: on-chain metadata (name, description, model,
// skills) plus the system prompt and an optional `match` regex that limits which task specs the
// agent takes. Several agents with different profiles can run side by side, each with its own key.
function loadProfile(name) {
  const p = path.join(__dirname, "profiles", `${name}.json`);
  if (!fs.existsSync(p)) throw new Error(`No agent profile ${p}. Available: ${fs.readdirSync(path.join(__dirname, "profiles")).map((f) => f.replace(/\.json$/, "")).join(", ")}`);
  const prof = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const k of ["name", "description", "model", "skills", "system"]) {
    if (prof[k] === undefined) throw new Error(`Profile ${name} is missing "${k}"`);
  }
  prof.matcher = prof.match ? new RegExp(prof.match, "i") : null;
  prof.metadataURI = "data:application/json;base64," + Buffer.from(JSON.stringify({
    name: prof.name, description: prof.description, model: prof.model, skills: prof.skills,
  })).toString("base64");
  return prof;
}

// Public Sepolia RPCs go down for minutes at a time (the agent log is full of ENOTFOUND / timeout
// from a single endpoint). Use several, quorum 1, so one bad endpoint never stalls the agent.
const CHAIN_IDS = { sepolia: 11155111, localhost: 31337, baseSepolia: 84532 };
const DEFAULT_RPCS = {
  sepolia: [
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://sepolia.drpc.org",
    "https://1rpc.io/sepolia",
    "https://rpc.sepolia.org",
  ],
  baseSepolia: ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"],
  localhost: ["http://127.0.0.1:8545"],
};

function rpcUrls(network) {
  const env = network === "sepolia" ? process.env.SEPOLIA_RPC_URLS || process.env.SEPOLIA_RPC_URL
    : network === "baseSepolia" ? process.env.BASE_SEPOLIA_RPC_URLS || process.env.BASE_SEPOLIA_RPC_URL
    : process.env.RPC_URL;
  const fromEnv = (env || "").split(",").map((u) => u.trim()).filter(Boolean);
  const all = [...fromEnv, ...(DEFAULT_RPCS[network] || [])];
  return [...new Set(all)];
}

function makeProvider(network) {
  const { ethers } = require("ethers");
  const urls = rpcUrls(network);
  if (!urls.length) throw new Error(`No RPC URL known for network ${network}; set RPC_URL`);
  const chainId = CHAIN_IDS[network];
  const net = chainId ? ethers.Network.from(chainId) : undefined;
  const make = (u) => new ethers.JsonRpcProvider(u, net, net ? { staticNetwork: net } : {});
  if (urls.length === 1) return make(urls[0]);
  return new ethers.FallbackProvider(
    urls.map((u, i) => ({ provider: make(u), priority: i + 1, weight: 1, stallTimeout: 1500 })),
    net,
    { quorum: 1 },
  );
}

module.exports = { loadDeployment, loadAbi, encodeUri, decodeUri, loadProfile, makeProvider, rpcUrls };
