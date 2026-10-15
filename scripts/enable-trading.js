// Opens trading for everyone. Irreversible. Usage:
//   TOKEN_ADDRESS=0x... npx hardhat run scripts/enable-trading.js --network sepolia
const { ethers } = require("hardhat");

async function main() {
  const address = process.env.TOKEN_ADDRESS;
  if (!address) throw new Error("Set TOKEN_ADDRESS to the deployed CrazyCoin address");
  const coin = await ethers.getContractAt("CrazyCoin", address);
  const tx = await coin.enableTrading();
  await tx.wait();
  console.log(`Trading enabled on ${address} in tx ${tx.hash}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
