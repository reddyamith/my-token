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

module.exports = { loadDeployment, loadAbi, encodeUri, decodeUri };
