# Mainnet checklist

What has to be true before Delegra moves real money. Each item is a gate, not a suggestion.
Target chain: Base (cheap, fast, USDC-native). Status column is updated as items close.

| # | Gate | Why | Status |
|---|---|---|---|
| 1 | External audit of `DelegraToken`, `AgentRegistry`, `TaskEscrow`, `TeamVesting`, `TokenLock` | Escrow holds other people's USDC; one bug ends the project | Not started. Slither clean (see README). Budget: a small firm or a Code4rena/Sherlock contest |
| 2 | Admin keys on a multisig (Safe, 2-of-3 minimum) with a 24h timelock | Today one key can change fee, treasury, arbiter, allowed tokens | Procedure + `scripts/transfer-admin.js` done ([MULTISIG.md](MULTISIG.md)); Safe not created yet |
| 3 | Team share (20%) moved into `TeamVesting` on mainnet, address published | Buyers must be able to verify the founder cannot dump | Contract done, deploy pending |
| 4 | Liquidity-pool tokens locked in `TokenLock` for at least 12 months, address published | Proves liquidity cannot be pulled | Contract done, deploy pending |
| 5 | Real USDC address passed as `USDC_ADDRESS`; `MockUSDC` never deployed | MockUSDC has a public mint | Script supports it |
| 6 | Arbiter is a named, reachable party (or a small panel), with a published dispute policy | Rejections route to the arbiter; nobody trusts an anonymous judge | Not started |
| 7 | Agent on a 24/7 host (not a laptop), with alerting when it stops | A dead agent means open tasks time out and bonds get slashed | Partly: launchd job written, cloud host pending |
| 8 | Published token distribution and vesting schedule, matching what the contracts enforce | "Plan, not a promise" on the site becomes a promise | Draft on the site |
| 9 | Legal review in the founder's jurisdiction (India): token classification, KYC needs, tax treatment | Fee income and token sales are taxable; promotion rules apply | Not started. Talk to a CA and a crypto lawyer |
| 10 | Bug bounty page (even a small one) and a security contact | Cheap insurance, expected by users | Not started |
| 11 | Mainnet dry run on Base Sepolia with the exact deploy script and parameters | Catches config mistakes before they cost real money | Not started |
| 12 | Launch communications say "mainnet beta", with limits (max task size, max agents) for the first weeks | Limits the blast radius of a bug | Not started |

## Parameters to decide before deploy

- Minimum bond (today 1,000 DLGR on testnet)
- Protocol fee (1%, hard cap 5%)
- Review window (3 days) and unbond cooldown (7 days)
- Initial liquidity: how much DLGR and ETH go into the pool, and at what starting price
- Treasury address (the multisig)

## Order of operations on launch day

1. Deploy token, registry, escrow with the multisig as owner and treasury.
2. Deploy vesting and lock; transfer the team share into vesting.
3. Create the Uniswap pool; send LP tokens to the lock.
4. Verify every contract on the explorer; publish all addresses on the site and in the README.
5. Register the first agent; post one small real task end to end.
6. Announce, with the limits from gate 12.
