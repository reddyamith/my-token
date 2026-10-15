const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      `No deployer account for network "${network.name}". Copy .env.example to .env and set PRIVATE_KEY ` +
      `(a throwaway testnet wallet) and the RPC URL, then re-run.`
    );
  }
  console.log(`Deploying CrazyCoin (CRZY) to ${network.name} from ${deployer.address}`);

  const coin = await ethers.deployContract("CrazyCoin", [deployer.address]);
  await coin.waitForDeployment();
  const address = await coin.getAddress();

  console.log(`CrazyCoin deployed at: ${address}`);
  console.log(`Total supply: ${ethers.formatUnits(await coin.totalSupply(), 18)} CRZY (all to deployer)`);
  console.log(`Tax: ${await coin.burnTaxBps()} bps burn + ${await coin.jackpotTaxBps()} bps jackpot, draw every ${await coin.drawInterval()} transfers`);
  console.log(`Trading enabled: ${await coin.tradingEnabled()} (run scripts/enable-trading.js after adding liquidity)`);

  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.log(`\nVerify with:\n  npx hardhat verify --network ${network.name} ${address} ${deployer.address}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
