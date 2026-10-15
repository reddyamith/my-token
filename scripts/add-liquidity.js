// Creates the CRZY/ETH Uniswap V2 pool and seeds it with liquidity. Usage:
//   TOKEN_ADDRESS=0x... [LIQ_TOKENS=10000000000] [LIQ_ETH=0.01] npx hardhat run scripts/add-liquidity.js --network sepolia
//
// Keep LIQ_TOKENS at or below 1% of supply: the pool is a normal (taxed, limited) holder, so taxed
// sells into it revert once it holds more than maxWalletAmount (2%) unless limits are turned off.
const { ethers, network } = require("hardhat");

const ROUTERS = {
  sepolia: "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3", // Uniswap V2 Router02
  mainnet: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
};

const ROUTER_ABI = [
  "function factory() view returns (address)",
  "function WETH() view returns (address)",
  "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)",
];
const FACTORY_ABI = ["function getPair(address, address) view returns (address)"];
const PAIR_ABI = ["function getReserves() view returns (uint112, uint112, uint32)", "function token0() view returns (address)"];

async function main() {
  const address = process.env.TOKEN_ADDRESS;
  if (!address) throw new Error("Set TOKEN_ADDRESS to the deployed CrazyCoin address");
  const routerAddress = ROUTERS[network.name];
  if (!routerAddress) throw new Error(`No Uniswap V2 router configured for ${network.name}`);

  const tokens = ethers.parseUnits(process.env.LIQ_TOKENS || "10000000000", 18);
  const eth = ethers.parseEther(process.env.LIQ_ETH || "0.01");

  const [owner] = await ethers.getSigners();
  const coin = await ethers.getContractAt("CrazyCoin", address);
  const router = new ethers.Contract(routerAddress, ROUTER_ABI, owner);

  console.log(`Adding ${ethers.formatUnits(tokens, 18)} CRZY + ${ethers.formatEther(eth)} ETH on ${network.name}`);

  const approveTx = await coin.approve(routerAddress, tokens);
  await approveTx.wait();
  console.log(`Approved router in tx ${approveTx.hash}`);

  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  const tx = await router.addLiquidityETH(address, tokens, tokens, eth, owner.address, deadline, { value: eth });
  await tx.wait();
  console.log(`Liquidity added in tx ${tx.hash}`);

  const factory = new ethers.Contract(await router.factory(), FACTORY_ABI, owner);
  const pairAddress = await factory.getPair(address, await router.WETH());
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, owner);
  const [r0, r1] = await pair.getReserves();
  const tokenIsToken0 = (await pair.token0()).toLowerCase() === address.toLowerCase();
  const [crzyReserve, ethReserve] = tokenIsToken0 ? [r0, r1] : [r1, r0];

  console.log(`Pair: ${pairAddress}`);
  console.log(`Reserves: ${ethers.formatUnits(crzyReserve, 18)} CRZY / ${ethers.formatEther(ethReserve)} ETH`);
  console.log(`LP tokens were sent to ${owner.address}; lock them before announcing a mainnet launch.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
