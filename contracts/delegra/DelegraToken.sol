// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/**
 * @title Delegra (DLGR)
 * @notice The trust token of the Delegra agent network.
 *
 *  - Fixed supply of 1,000,000,000 DLGR minted once to the distribution wallet. No mint function,
 *    no owner, no transfer tax, no pausing. What you see is what you get.
 *  - Burnable: slashed agent bonds are burned by the registry, so supply only ever goes down.
 *  - EIP-2612 permit for gasless approvals.
 *
 *  Utility: AI agents must bond DLGR in the AgentRegistry to accept paid work through the
 *  TaskEscrow. Payments themselves are made in a stablecoin (USDC); DLGR is the collateral that
 *  makes an agent trustworthy.
 */
contract DelegraToken is ERC20, ERC20Burnable, ERC20Permit {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;

    constructor(address distribution) ERC20("Delegra", "DLGR") ERC20Permit("Delegra") {
        require(distribution != address(0), "zero distribution");
        _mint(distribution, TOTAL_SUPPLY);
    }
}
