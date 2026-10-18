# Admin handover to a multisig

Gate 2 of the [mainnet checklist](MAINNET.md). Today one key (the deployer) can change the
protocol fee, treasury, arbiter, allowed payment tokens, minimum bond and cooldowns. Before real
money, those powers move to a Safe multisig behind a timelock, so no single person, and no single
stolen laptop, can change them quietly.

## What the admin key controls

| Contract | Admin functions | Blast radius if abused |
|---|---|---|
| `AgentRegistry` | `setEscrow`, `setMinBond`, `setUnbondCooldown` | Point the registry at a malicious escrow that can slash every bond |
| `TaskEscrow` | `setFeeBps` (cap 5%), `setTreasury`, `setArbiter`, `setPaymentTokenAllowed`, `setReviewWindow` | Redirect fees, decide disputes, allow a fake payment token |
| `DelegraToken` | none | Fixed supply, no owner, nothing to hand over |
| `TeamVesting`, `TokenLock` | none | Beneficiary only; immutable schedule |

Both admin contracts use OpenZeppelin `Ownable2Step`: the current owner *proposes* a new owner and
the new owner must *accept*. A typo in the address cannot brick the contracts, because the old
owner stays in control until the acceptance lands.

## Target setup

```
signers (3 people, 2 must agree)
        |
   Safe multisig  --->  TimelockController (24h delay)  --->  AgentRegistry, TaskEscrow (owner)
        |
   TaskEscrow.treasury (fees arrive here directly, no delay needed)
```

- **Safe**: 2-of-3 for the first months. Signers on separate devices, at least one hardware wallet.
  Three people is the minimum that survives one lost key.
- **Timelock**: OpenZeppelin `TimelockController` with `minDelay = 86400`, the Safe as the only
  proposer and executor. Every admin change becomes visible on-chain a day before it takes effect,
  so users and agents can leave if they disagree.
- **Treasury**: the Safe itself. Fees are plain USDC transfers; nothing dangerous happens on receipt.

Start without the timelock only if the launch is tagged "mainnet beta" with small limits
(gate 12) and the timelock is added within the first month.

## Procedure

1. **Create the Safe** at app.safe.global on the target chain. Add the three signer addresses,
   threshold 2. Send it a little ETH for gas. Write down the Safe address.
2. **Deploy the timelock** (skip for the beta shortcut):
   `TimelockController(86400, [safe], [safe], address(0))`. The zero admin means the Safe is the
   only party that can change the proposer and executor roles later.
3. **Dry run on testnet**: run step 4 and 5 on Sepolia with a test Safe first. The deployments
   json records the pending owner, so the site and README can show it.
4. **Propose the handover** from the deployer key:
   ```
   NEW_OWNER=0xTimelockOrSafe TREASURY=0xSafe npx hardhat run scripts/transfer-admin.js --network <net>
   ```
   This sets the treasury to the Safe and calls `transferOwnership(NEW_OWNER)` on both contracts.
   Nothing changes hands yet.
5. **Accept** from the new owner. With a plain Safe as owner: Safe UI, New transaction, Contract
   interaction, paste the contract address and ABI, call `acceptOwnership()`, collect 2 signatures,
   execute. Do this for `AgentRegistry` and `TaskEscrow`. With a timelock as owner: the Safe
   schedules `acceptOwnership()` on the timelock, waits the delay, then executes it.
6. **Verify**: `owner()` on both contracts returns the new owner, `pendingOwner()` is zero,
   `treasury()` on the escrow is the Safe. Then remove `pendingOwner` from the deployments json,
   publish the Safe and timelock addresses on the site, in the README and in the launch kit.
7. **Retire the deployer key**: move any remaining DLGR and ETH out of it. It should hold nothing
   worth stealing afterwards.

## Day-to-day after the handover

- A fee or parameter change is: one signer proposes on the Safe, a second confirms, (timelock:
  wait 24h, execute). Announce it on X and Telegram when it is scheduled, not when it lands.
- Emergency (bug found): there is no pause switch by design. The fastest mitigation is
  `setPaymentTokenAllowed(usdc, false)` so no new tasks can be created, which still goes through
  the Safe and, if present, the timelock. Decide before launch whether the timelock should have a
  shorter emergency path; the default answer is no, because an emergency path is also an attack path.
- Signer leaves: Safe UI, swap owner, same 2-of-3 threshold. No contract change needed.

## What this does not fix

- The arbiter is still a single address (gate 6). A multisig can *be* the arbiter, but dispute
  handling needs a published policy, not just more signatures.
- The agent host's private key is an operational key, not an admin key. It can only lose its own
  bond. Keep it separate from the signer keys.
