// Hands admin control of AgentRegistry and TaskEscrow to a new owner (a Safe multisig or a
// TimelockController), and points the escrow treasury at it. Both contracts are Ownable2Step,
// so this script only *proposes*; the new owner must call acceptOwnership() on each contract
// (from the Safe UI: New transaction > Contract interaction > acceptOwnership).
//
//   NEW_OWNER=0xSafe... npx hardhat run scripts/transfer-admin.js --network sepolia
// Env: NEW_OWNER (required), TREASURY (default NEW_OWNER; set to "skip" to leave treasury alone).
// See docs/MULTISIG.md for the full handover procedure.
const { ethers, network } = require("hardhat");
const fs = require("fs");

async function main() {
  const newOwner = process.env.NEW_OWNER;
  if (!newOwner || !ethers.isAddress(newOwner)) throw new Error("NEW_OWNER must be a valid address");
  const treasury = process.env.TREASURY === "skip" ? null : (process.env.TREASURY || newOwner);
  if (treasury && !ethers.isAddress(treasury)) throw new Error("TREASURY must be a valid address");

  const [signer] = await ethers.getSigners();
  const depPath = `deployments/delegra-${network.name}.json`;
  const dep = JSON.parse(fs.readFileSync(depPath, "utf8"));
  const registry = await ethers.getContractAt("AgentRegistry", dep.AgentRegistry, signer);
  const escrow = await ethers.getContractAt("TaskEscrow", dep.TaskEscrow, signer);

  for (const [name, c] of [["AgentRegistry", registry], ["TaskEscrow", escrow]]) {
    const owner = await c.owner();
    if (owner.toLowerCase() !== signer.address.toLowerCase()) {
      throw new Error(`${name} is owned by ${owner}, not by the signer ${signer.address}`);
    }
  }

  if (treasury) {
    const tx = await escrow.setTreasury(treasury);
    await tx.wait();
    console.log(`TaskEscrow.treasury -> ${treasury} (${tx.hash})`);
    dep.treasury = treasury;
  }

  for (const [name, c] of [["AgentRegistry", registry], ["TaskEscrow", escrow]]) {
    const tx = await c.transferOwnership(newOwner);
    await tx.wait();
    console.log(`${name}: ownership proposed to ${newOwner} (${tx.hash})`);
  }

  dep.pendingOwner = newOwner;
  fs.writeFileSync(depPath, JSON.stringify(dep, null, 2) + "\n");
  console.log(`\nNow call acceptOwnership() on both contracts from ${newOwner}.`);
  console.log(`Until then the old key stays owner; the proposal can be cancelled with transferOwnership(signer).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
