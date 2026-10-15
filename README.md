# CrazyCoin (CRZY) 🎰🔥

A fixed-supply, deflationary meme token where **every transfer is a lottery ticket**.
Solidity 0.8.28 · OpenZeppelin 5 · Hardhat · deploy-ready for Sepolia and Base Sepolia.

## Tokenomics

| | |
|---|---|
| Supply | 1,000,000,000,000 CRZY (1 trillion), minted once to the deployer. **No mint function.** |
| Transfer tax | 3% total: **1% burned forever**, **2% into the jackpot pot** |
| Jackpot | Every 100 taxed transfers the whole pot is paid to one of the last 32 senders, picked at random |
| Lucky 7 | Send an amount ending in **777 whole CRZY** (777, 1 777, 42 777…) and pay **no tax** |
| Anti-whale | Max 1% of supply per transfer, max 2% of supply per wallet (owner can switch off) |
| Trading gate | Transfers are closed until the owner calls `enableTrading()` once. Irreversible. |
| Gasless approvals | EIP-2612 `permit` |

Owner powers are deliberately tiny: tune the tax (hard-capped at 5% total), set the draw interval (min 10),
toggle whale limits, exempt addresses (DEX router, pool, treasury) from tax and limits, and renounce ownership
to freeze the rules forever.

> ⚠️ Jackpot randomness uses `block.prevrandao` + previous blockhash. Fine for a meme raffle, not for
> anything a block proposer would bother to game. Nothing here is financial advice; test on a testnet first.

## Quick start

```bash
npm install
npx hardhat test                                   # 16 tests
npx hardhat run scripts/deploy.js                  # deploy to an in-process chain
```

## Deploy to a testnet

```bash
cp .env.example .env     # fill in RPC URL + a throwaway deployer private key (never your main wallet)
npx hardhat run scripts/deploy.js --network sepolia          # or --network baseSepolia
npx hardhat verify --network sepolia <ADDRESS> <DEPLOYER_ADDRESS>
```

Launch sequence recommended for a real launch:
1. Deploy. Trading is closed, so nobody can snipe.
2. `setExempt(router, true)` and `setExempt(pool, true)` so the DEX isn't blocked by the whale limits.
3. Add liquidity.
4. `TOKEN_ADDRESS=0x... npx hardhat run scripts/enable-trading.js --network sepolia`
5. Optionally `renounceOwnership()` once you're happy with the parameters.

## Layout

- `contracts/CrazyCoin.sol` — the token
- `test/CrazyCoin.test.js` — behaviour tests (taxes, Lucky 7, limits, jackpot draw, permit)
- `scripts/deploy.js`, `scripts/enable-trading.js`
- `.github/workflows/ci.yml` — runs the tests on every push
