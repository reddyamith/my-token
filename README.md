# MyToken (ERC-20)

Capped, burnable ERC-20 token built with Solidity 0.8.28 (cancun) + OpenZeppelin 5 + Hardhat.

- Initial supply: 100,000,000 MTK (minted to deployer)
- Max supply (cap): 1,000,000,000 MTK
- Owner can mint up to the cap; anyone can burn their own tokens; EIP-2612 permit supported.

## Usage
```bash
npm install
npx hardhat test                      # run tests
npx hardhat node                      # local chain (separate terminal)
npx hardhat run scripts/deploy.js --network localhost
cp .env.example .env                  # fill in RPC URL + testnet private key
npx hardhat run scripts/deploy.js --network sepolia
npx hardhat verify --network sepolia <ADDRESS> "MyToken" "MTK" <SUPPLY_WEI> <CAP_WEI> <OWNER>
```
Change name/symbol/supply via env vars (see `.env.example`) or edit `scripts/deploy.js`.
