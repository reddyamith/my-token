// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MyToken - a capped, burnable ERC-20 with owner-controlled minting
contract MyToken is ERC20, ERC20Burnable, ERC20Permit, Ownable {
    uint256 public immutable cap;

    error CapExceeded(uint256 requested, uint256 available);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply,
        uint256 cap_,
        address initialOwner
    ) ERC20(name_, symbol_) ERC20Permit(name_) Ownable(initialOwner) {
        require(cap_ > 0 && initialSupply <= cap_, "bad cap");
        cap = cap_;
        _mint(initialOwner, initialSupply);
    }

    /// @notice Mint new tokens, up to the cap. Owner only.
    function mint(address to, uint256 amount) external onlyOwner {
        uint256 available = cap - totalSupply();
        if (amount > available) revert CapExceeded(amount, available);
        _mint(to, amount);
    }
}
