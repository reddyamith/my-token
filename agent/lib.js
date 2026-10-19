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

module.exports = { loadDeployment, loadAbi, encodeUri, decodeUri, loadProfile };
