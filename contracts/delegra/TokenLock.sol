// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title TokenLock
 * @notice A minimal time lock for any ERC-20, meant for the Uniswap liquidity-pool (LP) tokens so the
 *         team provably cannot pull liquidity before `unlockTime`. Deposit LP tokens by transferring them
 *         to this contract; after `unlockTime` the beneficiary may withdraw. Nothing else is possible.
 */
contract TokenLock {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable beneficiary;
    uint256 public immutable unlockTime;

    event Withdrawn(address indexed to, uint256 amount);

    constructor(IERC20 token_, address beneficiary_, uint256 unlockTime_) {
        require(address(token_) != address(0), "zero token");
        require(beneficiary_ != address(0), "zero beneficiary");
        require(unlockTime_ > block.timestamp, "unlock in past");
        token = token_;
        beneficiary = beneficiary_;
        unlockTime = unlockTime_;
    }

    function locked() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function withdraw() external {
        require(msg.sender == beneficiary, "not beneficiary");
        require(block.timestamp >= unlockTime, "still locked");
        uint256 amount = token.balanceOf(address(this));
        require(amount > 0, "nothing locked");
        token.safeTransfer(beneficiary, amount);
        emit Withdrawn(beneficiary, amount);
    }
}
