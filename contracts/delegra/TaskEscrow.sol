// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AgentRegistry.sol";

/**
 * @title TaskEscrow
 * @notice Delegate a task to an AI agent. Payment (USDC) sits in escrow, the agent's DLGR bond is
 *         locked for the duration, and the agent is paid only when the client accepts the result.
 *
 *  Flow
 *  ----
 *  1. client: createTask(payment, bondRequired, deadline, specURI, agent?)  -> Open
 *  2. agent:  acceptTask(id)                                                  -> Accepted (bond locked)
 *  3. agent:  submitResult(id, resultURI)                                     -> Submitted
 *  4. client: approve(id)        -> agent paid minus protocol fee, bond released   -> Completed
 *     client: reject(id, reason) -> Disputed; arbiter decides
 *     anyone after reviewWindow: finalize(id) -> auto-approve (client went silent) -> Completed
 *  Alternative endings:
 *     client: cancel(id) while Open                                           -> Cancelled, refund
 *     client: claimTimeout(id) after deadline with no submission -> refund + bond slashed -> Failed
 *     arbiter: resolve(id, agentWins) on a Disputed task
 *
 *  Protocol fee: `feeBps` of the payment (default 1%) goes to the treasury.
 *  Slashing: on failure the locked bond is slashed; half burned, half to the client.
 */
contract TaskEscrow is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { Open, Accepted, Submitted, Completed, Cancelled, Failed, Disputed }

    struct Task {
        address client;
        address agent;          // address(0) while Open with no assignment
        IERC20 paymentToken;
        uint256 payment;        // amount escrowed
        uint256 bondRequired;   // DLGR the agent must lock
        uint64 deadline;        // agent must submit by this time
        uint64 submittedAt;
        Status status;
        string specURI;         // what to do (IPFS / https)
        string resultURI;       // what was delivered
    }

    AgentRegistry public immutable registry;
    address public treasury;
    address public arbiter;
    uint256 public feeBps = 100; // 1%
    uint64 public reviewWindow = 3 days;
    uint256 public constant MAX_FEE_BPS = 500;

    uint256 public taskCount;
    mapping(uint256 => Task) private _tasks;
    mapping(address => bool) public allowedPaymentToken;

    event TaskCreated(uint256 indexed id, address indexed client, address indexed agent, address token, uint256 payment, uint256 bondRequired, uint64 deadline, string specURI);
    event TaskAccepted(uint256 indexed id, address indexed agent);
    event ResultSubmitted(uint256 indexed id, string resultURI);
    event TaskCompleted(uint256 indexed id, uint256 paidToAgent, uint256 fee);
    event TaskCancelled(uint256 indexed id);
    event TaskFailed(uint256 indexed id, uint256 refunded, uint256 slashed);
    event TaskDisputed(uint256 indexed id, string reason);
    event DisputeResolved(uint256 indexed id, bool agentWins);
    event PaymentTokenAllowed(address token, bool allowed);
    event FeeSet(uint256 feeBps);
    event TreasurySet(address treasury);
    event ArbiterSet(address arbiter);
    event ReviewWindowSet(uint64 window);

    error WrongStatus(Status current);
    error ZeroAddress();
    error NotClient();
    error NotAgent();
    error NotArbiter();
    error NotAssignedAgent();
    error AgentNotActive();
    error TokenNotAllowed();
    error BadDeadline();
    error DeadlineNotPassed();
    error ReviewWindowOpen();
    error FeeTooHigh();

    constructor(AgentRegistry registry_, address treasury_, address initialOwner) Ownable(initialOwner) {
        if (address(registry_) == address(0) || treasury_ == address(0)) revert ZeroAddress();
        registry = registry_;
        treasury = treasury_;
        arbiter = initialOwner;
    }

    // ------------------------------------------------------------------ views

    function getTask(uint256 id) external view returns (Task memory) {
        return _tasks[id];
    }

    // ------------------------------------------------------------------ client

    /// @notice Post a task and escrow the payment. `agent` may be address(0) for an open task.
    function createTask(
        IERC20 paymentToken,
        uint256 payment,
        uint256 bondRequired,
        uint64 deadline,
        string calldata specURI,
        address agent
    ) external nonReentrant returns (uint256 id) {
        if (!allowedPaymentToken[address(paymentToken)]) revert TokenNotAllowed();
        if (deadline <= block.timestamp) revert BadDeadline();

        paymentToken.safeTransferFrom(msg.sender, address(this), payment);

        id = ++taskCount;
        Task storage t = _tasks[id];
        t.client = msg.sender;
        t.agent = agent;
        t.paymentToken = paymentToken;
        t.payment = payment;
        t.bondRequired = bondRequired;
        t.deadline = deadline;
        t.status = Status.Open;
        t.specURI = specURI;

        emit TaskCreated(id, msg.sender, agent, address(paymentToken), payment, bondRequired, deadline, specURI);
    }

    function cancel(uint256 id) external nonReentrant {
        Task storage t = _tasks[id];
        if (msg.sender != t.client) revert NotClient();
        if (t.status != Status.Open) revert WrongStatus(t.status);
        t.status = Status.Cancelled;
        t.paymentToken.safeTransfer(t.client, t.payment);
        emit TaskCancelled(id);
    }

    function approve(uint256 id) external nonReentrant {
        Task storage t = _tasks[id];
        if (msg.sender != t.client) revert NotClient();
        if (t.status != Status.Submitted) revert WrongStatus(t.status);
        _complete(id, t);
    }

    function reject(uint256 id, string calldata reason) external {
        Task storage t = _tasks[id];
        if (msg.sender != t.client) revert NotClient();
        if (t.status != Status.Submitted) revert WrongStatus(t.status);
        t.status = Status.Disputed;
        emit TaskDisputed(id, reason);
    }

    /// @notice Agent accepted but never delivered by the deadline: refund the client and slash.
    function claimTimeout(uint256 id) external nonReentrant {
        Task storage t = _tasks[id];
        if (msg.sender != t.client) revert NotClient();
        if (t.status != Status.Accepted) revert WrongStatus(t.status);
        if (block.timestamp <= t.deadline) revert DeadlineNotPassed();
        _fail(id, t);
    }

    // ------------------------------------------------------------------ agent

    function acceptTask(uint256 id) external nonReentrant {
        Task storage t = _tasks[id];
        if (t.status != Status.Open) revert WrongStatus(t.status);
        if (t.agent != address(0) && t.agent != msg.sender) revert NotAssignedAgent();
        if (!registry.isActive(msg.sender)) revert AgentNotActive();

        t.agent = msg.sender;
        t.status = Status.Accepted;
        registry.lockBond(msg.sender, t.bondRequired);
        emit TaskAccepted(id, msg.sender);
    }

    function submitResult(uint256 id, string calldata resultURI) external {
        Task storage t = _tasks[id];
        if (msg.sender != t.agent) revert NotAgent();
        if (t.status != Status.Accepted) revert WrongStatus(t.status);
        t.status = Status.Submitted;
        t.submittedAt = uint64(block.timestamp);
        t.resultURI = resultURI;
        emit ResultSubmitted(id, resultURI);
    }

    /// @notice If the client neither approves nor rejects within the review window, anyone can
    ///         finalize and the agent is paid. Silence is not a free ride for clients.
    function finalize(uint256 id) external nonReentrant {
        Task storage t = _tasks[id];
        if (t.status != Status.Submitted) revert WrongStatus(t.status);
        if (block.timestamp < t.submittedAt + reviewWindow) revert ReviewWindowOpen();
        _complete(id, t);
    }

    // ------------------------------------------------------------------ arbiter

    function resolve(uint256 id, bool agentWins) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter();
        Task storage t = _tasks[id];
        if (t.status != Status.Disputed) revert WrongStatus(t.status);
        emit DisputeResolved(id, agentWins);
        if (agentWins) _complete(id, t);
        else _fail(id, t);
    }

    // ------------------------------------------------------------------ internals

    function _complete(uint256 id, Task storage t) internal {
        t.status = Status.Completed;
        uint256 fee = (t.payment * feeBps) / 10_000;
        uint256 toAgent = t.payment - fee;
        if (fee > 0) t.paymentToken.safeTransfer(treasury, fee);
        t.paymentToken.safeTransfer(t.agent, toAgent);
        registry.releaseBond(t.agent, t.bondRequired);
        registry.recordJob(t.agent, true);
        emit TaskCompleted(id, toAgent, fee);
    }

    function _fail(uint256 id, Task storage t) internal {
        t.status = Status.Failed;
        t.paymentToken.safeTransfer(t.client, t.payment);
        registry.slash(t.agent, t.bondRequired, t.client);
        registry.recordJob(t.agent, false);
        emit TaskFailed(id, t.payment, t.bondRequired);
    }

    // ------------------------------------------------------------------ admin

    function setPaymentTokenAllowed(address token, bool allowed) external onlyOwner {
        allowedPaymentToken[token] = allowed;
        emit PaymentTokenAllowed(token, allowed);
    }

    function setFeeBps(uint256 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = bps;
        emit FeeSet(bps);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function setArbiter(address arbiter_) external onlyOwner {
        if (arbiter_ == address(0)) revert ZeroAddress();
        arbiter = arbiter_;
        emit ArbiterSet(arbiter_);
    }

    function setReviewWindow(uint64 window) external onlyOwner {
        require(window >= 1 hours && window <= 30 days, "bad window");
        reviewWindow = window;
        emit ReviewWindowSet(window);
    }
}
