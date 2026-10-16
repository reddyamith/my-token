// Deploys the team vesting wallet and (optionally) a liquidity lock, then funds the vesting wallet.
//   BENEFICIARY=0x... AMOUNT=200000000 npx hardhat run scripts/deploy-vesting.js --network sepolia
// Env: BENEFICIARY (default deployer), AMOUNT (whole DLGR to lock, default 0 = deploy only),
//      DURATION_DAYS (default 1095 = 3 years), CLIFF_DAYS (default 182 = 6 months),
//      LP_TOKEN + LP_LOCK_DAYS (optional: also deploy a TokenLock for Uniswap LP tokens).
const { ethers, network } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();
  const depPath = `deployments/delegra-${network.name}.json`;
  const dep = JSON.parse(fs.readFileSync(depPath, "utf8"));
  const dlgr = await ethers.getContractAt("DelegraToken", dep.DelegraToken, deployer);

  const beneficiary = process.env.BENEFICIARY || deployer.address;
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const duration = Number(process.env.DURATION_DAYS || 1095) * 86400;
  const cliff = Number(process.env.CLIFF_DAYS || 182) * 86400;

  const vesting = await ethers.deployContract("TeamVesting", [beneficiary, now, duration, cliff]);
  await vesting.waitForDeployment();
  console.log(`TeamVesting: ${await vesting.getAddress()} (beneficiary ${beneficiary}, ${duration / 86400}d, cliff ${cliff / 86400}d)`);
  dep.TeamVesting = await vesting.getAddress();

  const amount = ethers.parseUnits(process.env.AMOUNT || "0", 18);
  if (amount > 0n) {
    const tx = await dlgr.transfer(await vesting.getAddress(), amount);
    await tx.wait();
    console.log(`Locked ${ethers.formatUnits(amount, 18)} DLGR in ${tx.hash}`);
  }

  if (process.env.LP_TOKEN) {
    const unlock = now + Number(process.env.LP_LOCK_DAYS || 365) * 86400;
    const lock = await ethers.deployContract("TokenLock", [process.env.LP_TOKEN, beneficiary, unlock]);
    await lock.waitForDeployment();
    console.log(`TokenLock for LP: ${await lock.getAddress()} (unlocks ${new Date(unlock * 1000).toISOString()})`);
    dep.LiquidityLock = await lock.getAddress();
  }

  fs.writeFileSync(depPath, JSON.stringify(dep, null, 2) + "\n");
  console.log(`Saved to ${depPath}`);
  console.log(`Verify: npx hardhat verify --network ${network.name} ${dep.TeamVesting} ${beneficiary} ${now} ${duration} ${cliff}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
