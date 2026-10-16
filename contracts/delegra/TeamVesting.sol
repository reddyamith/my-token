// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/finance/VestingWalletCliff.sol";

/**
 * @title TeamVesting
 * @notice Locks the team's DLGR and releases it linearly over `durationSeconds`, with nothing
 *         releasable before the cliff. Built on OpenZeppelin's audited VestingWallet.
 *
 *  - Tokens are transferred INTO this contract after deployment; whatever it holds follows the schedule.
 *  - Only the schedule decides what can be withdrawn. Nobody, including the beneficiary, can speed it up.
 *  - `release(token)` is permissionless: anyone may trigger it and the vested amount goes to the beneficiary.
 *  - Defaults used by the deploy script: 3-year duration, 6-month cliff.
 */
contract TeamVesting is VestingWalletCliff {
    constructor(address beneficiary, uint64 startTimestamp, uint64 durationSeconds, uint64 cliffSeconds)
        VestingWallet(beneficiary, startTimestamp, durationSeconds)
        VestingWalletCliff(cliffSeconds)
    {}
}
