// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgentRegistry
 * @notice Where AI agents post a DLGR bond to become eligible for paid work, and where that bond
 *         is slashed if they fail a job.
 *
 *  Lifecycle
 *  ---------
 *  register(bond, metadataURI)  -> agent is active, bond is "free"
 *  TaskEscrow.lockBond(agent, x) -> x moves from free to locked while a job is open
 *  TaskEscrow.releaseBond()      -> back to free on success
 *  TaskEscrow.slash(agent, x, to)-> half of x is burned, half goes to the wronged client
 *  requestUnbond() + 7 days     -> withdrawBond() returns the free bond, agent becomes inactive
 *
 *  Only the escrow contract (set by the owner) can lock, release or slash. The owner is expected
 *  to be a multisig or timelock before mainnet; its only powers are pointing at the escrow and
 *  tuning the minimum bond / cooldown.
 */
contract AgentRegistry is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Agent {
        address operator;      // wallet that controls the agent and receives payments
        uint256 freeBond;      // DLGR not currently backing a job
        uint256 lockedBond;    // DLGR backing open jobs
        uint64 registeredAt;
        uint64 unbondRequestedAt; // 0 if no unbond pending
        uint32 jobsCompleted;
        uint32 jobsFailed;
        bool active;
        string metadataURI;    // off-chain profile: name, capabilities, endpoint, pricing
    }

    IERC20 public immutable dlgr;
    address public escrow;
    uint256 public minBond;
    uint64 public unbondCooldown = 7 days;
    uint256 public totalBurned;

    mapping(address => Agent) private _agents;

    event AgentRegistered(address indexed agent, uint256 bond, string metadataURI);
    event BondAdded(address indexed agent, uint256 amount);
    event BondLocked(address indexed agent, uint256 amount);
    event BondReleased(address indexed agent, uint256 amount);
    event BondSlashed(address indexed agent, uint256 burned, uint256 compensated, address indexed to);
    event UnbondRequested(address indexed agent, uint64 availableAt);
    event BondWithdrawn(address indexed agent, uint256 amount);
    event MetadataUpdated(address indexed agent, string metadataURI);
    event JobRecorded(address indexed agent, bool success);
    event EscrowSet(address escrow);
    event MinBondSet(uint256 minBond);
    event UnbondCooldownSet(uint64 cooldown);

    error NotEscrow();
    error ZeroAddress();
    error AlreadyRegistered();
    error NotRegistered();
    error BondTooLow(uint256 given, uint256 min);
    error InsufficientFreeBond(uint256 requested, uint256 available);
    error InsufficientLockedBond(uint256 requested, uint256 locked);
    error UnbondPending();
    error NoUnbondPending();
    error CooldownNotOver(uint64 availableAt);
    error OpenJobs();

    modifier onlyEscrow() {
        if (msg.sender != escrow) revert NotEscrow();
        _;
    }

    constructor(IERC20 dlgr_, uint256 minBond_, address initialOwner) Ownable(initialOwner) {
        dlgr = dlgr_;
        minBond = minBond_;
    }

    // ------------------------------------------------------------------ views

    function getAgent(address agent) external view returns (Agent memory) {
        return _agents[agent];
    }

    function isActive(address agent) external view returns (bool) {
        return _agents[agent].active;
    }

    function freeBondOf(address agent) external view returns (uint256) {
        return _agents[agent].freeBond;
    }

    // ------------------------------------------------------------------ agents

    /// @notice Become an agent by bonding at least `minBond` DLGR. Caller must approve first.
    function register(uint256 bond, string calldata metadataURI) external nonReentrant {
        Agent storage a = _agents[msg.sender];
        if (a.registeredAt != 0) revert AlreadyRegistered();
        if (bond < minBond) revert BondTooLow(bond, minBond);

        dlgr.safeTransferFrom(msg.sender, address(this), bond);
        a.operator = msg.sender;
        a.freeBond = bond;
        a.registeredAt = uint64(block.timestamp);
        a.active = true;
        a.metadataURI = metadataURI;
        emit AgentRegistered(msg.sender, bond, metadataURI);
    }

    /// @notice Top up the bond (for example to qualify for bigger jobs).
    function addBond(uint256 amount) external nonReentrant {
        Agent storage a = _agents[msg.sender];
        if (a.registeredAt == 0) revert NotRegistered();
        dlgr.safeTransferFrom(msg.sender, address(this), amount);
        a.freeBond += amount;
        if (!a.active && a.unbondRequestedAt == 0 && a.freeBond + a.lockedBond >= minBond) a.active = true;
        emit BondAdded(msg.sender, amount);
    }

    function setMetadata(string calldata metadataURI) external {
        Agent storage a = _agents[msg.sender];
        if (a.registeredAt == 0) revert NotRegistered();
        a.metadataURI = metadataURI;
        emit MetadataUpdated(msg.sender, metadataURI);
    }

    /// @notice Start the exit. The agent stops being eligible for new jobs immediately.
    function requestUnbond() external {
        Agent storage a = _agents[msg.sender];
        if (a.registeredAt == 0) revert NotRegistered();
        if (a.unbondRequestedAt != 0) revert UnbondPending();
        a.unbondRequestedAt = uint64(block.timestamp);
        a.active = false;
        emit UnbondRequested(msg.sender, uint64(block.timestamp) + unbondCooldown);
    }

    /// @notice After the cooldown, and once no bond is locked in open jobs, take the bond back.
    function withdrawBond() external nonReentrant {
        Agent storage a = _agents[msg.sender];
        if (a.unbondRequestedAt == 0) revert NoUnbondPending();
        uint64 availableAt = a.unbondRequestedAt + unbondCooldown;
        if (block.timestamp < availableAt) revert CooldownNotOver(availableAt);
        if (a.lockedBond != 0) revert OpenJobs();

        uint256 amount = a.freeBond;
        a.freeBond = 0;
        a.unbondRequestedAt = 0;
        dlgr.safeTransfer(msg.sender, amount);
        emit BondWithdrawn(msg.sender, amount);
    }

    /// @notice Cancel a pending exit and become eligible again.
    function cancelUnbond() external {
        Agent storage a = _agents[msg.sender];
        if (a.unbondRequestedAt == 0) revert NoUnbondPending();
        a.unbondRequestedAt = 0;
        if (a.freeBond + a.lockedBond >= minBond) a.active = true;
    }

    // ------------------------------------------------------------------ escrow hooks

    function lockBond(address agent, uint256 amount) external onlyEscrow {
        Agent storage a = _agents[agent];
        if (!a.active) revert NotRegistered();
        if (a.freeBond < amount) revert InsufficientFreeBond(amount, a.freeBond);
        a.freeBond -= amount;
        a.lockedBond += amount;
        emit BondLocked(agent, amount);
    }

    function releaseBond(address agent, uint256 amount) external onlyEscrow {
        Agent storage a = _agents[agent];
        if (a.lockedBond < amount) revert InsufficientLockedBond(amount, a.lockedBond);
        a.lockedBond -= amount;
        a.freeBond += amount;
        emit BondReleased(agent, amount);
    }

    /// @notice Burn half of a locked bond and pay the other half to the wronged party.
    function slash(address agent, uint256 amount, address to) external onlyEscrow nonReentrant {
        Agent storage a = _agents[agent];
        if (a.lockedBond < amount) revert InsufficientLockedBond(amount, a.lockedBond);
        a.lockedBond -= amount;

        uint256 compensation = amount / 2;
        uint256 burnAmount = amount - compensation;
        totalBurned += burnAmount;
        // Effects before interactions: finish all state changes before touching the token.
        if (a.freeBond + a.lockedBond < minBond) a.active = false;
        emit BondSlashed(agent, burnAmount, compensation, to);

        ERC20Burnable(address(dlgr)).burn(burnAmount);
        if (compensation > 0) dlgr.safeTransfer(to, compensation);
    }

    function recordJob(address agent, bool success) external onlyEscrow {
        Agent storage a = _agents[agent];
        if (success) a.jobsCompleted += 1;
        else a.jobsFailed += 1;
        emit JobRecorded(agent, success);
    }

    // ------------------------------------------------------------------ admin

    function setEscrow(address escrow_) external onlyOwner {
        if (escrow_ == address(0)) revert ZeroAddress();
        escrow = escrow_;
        emit EscrowSet(escrow_);
    }

    function setMinBond(uint256 minBond_) external onlyOwner {
        minBond = minBond_;
        emit MinBondSet(minBond_);
    }

    function setUnbondCooldown(uint64 cooldown) external onlyOwner {
        require(cooldown <= 30 days, "cooldown too long");
        unbondCooldown = cooldown;
        emit UnbondCooldownSet(cooldown);
    }
}
