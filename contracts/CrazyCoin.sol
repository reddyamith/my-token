// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CrazyCoin (CRZY)
 * @notice A fixed-supply, deflationary meme token with a built-in jackpot lottery.
 *
 *  Tokenomics
 *  ----------
 *  - Fixed supply of 1,000,000,000,000 CRZY. No mint function exists, so supply can only shrink.
 *  - Every normal transfer pays a small tax (default 3%): 1% is burned forever and 2% goes into the
 *    on-chain jackpot pot held by this contract.
 *  - Every `drawInterval` taxed transfers (default 100) the whole pot is paid to one wallet drawn at
 *    random from the last 32 senders. Sending CRZY is your lottery ticket.
 *  - Anti-whale: max 1% of supply per transfer and max 2% of supply per wallet while limits are on.
 *  - Trading is closed until the owner flips `enableTrading()` once, so liquidity can be added first.
 *    Flipping it is irreversible.
 *  - Lucky 7: if the amount you send ends in 777 whole CRZY (e.g. 1,777 CRZY) your transfer is tax-free.
 *
 *  Governance is intentionally small: the owner can tune the tax (hard-capped at 5% total), tweak
 *  the draw interval, toggle the whale limits, exempt addresses (routers, pools, treasury), and
 *  renounce ownership to freeze everything forever.
 *
 *  Randomness uses block.prevrandao mixed with the previous blockhash. That is good enough for a
 *  meme-coin raffle but is NOT secure against a motivated block proposer. Do not use it for
 *  anything where real money depends on it being unpredictable.
 */
contract CrazyCoin is ERC20, ERC20Permit, Ownable {
    // ---------- constants ----------
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000_000 * 1e18; // 1 trillion
    uint256 public constant MAX_TOTAL_TAX_BPS = 500; // 5% hard cap on burn + jackpot combined
    uint256 public constant MIN_DRAW_INTERVAL = 10;
    uint8 public constant TICKET_RING_SIZE = 32;

    // ---------- tax config (basis points, 100 bps = 1%) ----------
    uint256 public burnTaxBps = 100; // 1%
    uint256 public jackpotTaxBps = 200; // 2%

    // ---------- anti-whale ----------
    bool public limitsEnabled = true;
    uint256 public maxTxAmount = TOTAL_SUPPLY / 100; // 1%
    uint256 public maxWalletAmount = TOTAL_SUPPLY / 50; // 2%

    // ---------- trading gate ----------
    bool public tradingEnabled;

    // ---------- jackpot ----------
    uint256 public drawInterval = 100;
    uint256 public taxedTransferCount;
    uint256 public totalJackpotsPaid;
    uint256 public totalBurned;
    address[TICKET_RING_SIZE] private _tickets;
    uint8 private _ticketCursor;
    uint8 private _ticketCount;

    mapping(address => bool) public isExempt;

    // ---------- events ----------
    event TradingEnabled(uint256 blockNumber);
    event TaxesUpdated(uint256 burnBps, uint256 jackpotBps);
    event LimitsToggled(bool enabled);
    event ExemptUpdated(address indexed account, bool exempt);
    event DrawIntervalUpdated(uint256 interval);
    event JackpotWon(address indexed winner, uint256 amount, uint256 drawNumber);
    event LuckySeven(address indexed sender, uint256 amount);

    // ---------- errors ----------
    error TradingNotOpen();
    error ExceedsMaxTx(uint256 amount, uint256 max);
    error ExceedsMaxWallet(uint256 resulting, uint256 max);
    error TaxTooHigh(uint256 totalBps);
    error IntervalTooShort(uint256 interval);

    constructor(address initialOwner) ERC20("CrazyCoin", "CRZY") ERC20Permit("CrazyCoin") Ownable(initialOwner) {
        isExempt[initialOwner] = true;
        isExempt[address(this)] = true;
        _mint(initialOwner, TOTAL_SUPPLY);
    }

    // ======================================================================
    //                                 views
    // ======================================================================

    /// @notice CRZY currently sitting in the jackpot pot.
    function jackpotPot() public view returns (uint256) {
        return balanceOf(address(this));
    }

    /// @notice Taxed transfers remaining until the next jackpot draw.
    function transfersUntilDraw() external view returns (uint256) {
        uint256 r = taxedTransferCount % drawInterval;
        return r == 0 ? drawInterval : drawInterval - r;
    }

    /// @notice The current raffle tickets (recent senders). Order is not meaningful.
    function tickets() external view returns (address[] memory out) {
        out = new address[](_ticketCount);
        for (uint256 i = 0; i < _ticketCount; i++) out[i] = _tickets[i];
    }

    function totalTaxBps() public view returns (uint256) {
        return burnTaxBps + jackpotTaxBps;
    }

    // ======================================================================
    //                              owner controls
    // ======================================================================

    /// @notice Open trading for everyone. Cannot be undone.
    function enableTrading() external onlyOwner {
        tradingEnabled = true;
        emit TradingEnabled(block.number);
    }

    function setTaxes(uint256 burnBps, uint256 jackpotBps) external onlyOwner {
        if (burnBps + jackpotBps > MAX_TOTAL_TAX_BPS) revert TaxTooHigh(burnBps + jackpotBps);
        burnTaxBps = burnBps;
        jackpotTaxBps = jackpotBps;
        emit TaxesUpdated(burnBps, jackpotBps);
    }

    function setLimitsEnabled(bool enabled) external onlyOwner {
        limitsEnabled = enabled;
        emit LimitsToggled(enabled);
    }

    function setExempt(address account, bool exempt) external onlyOwner {
        isExempt[account] = exempt;
        emit ExemptUpdated(account, exempt);
    }

    function setDrawInterval(uint256 interval) external onlyOwner {
        if (interval < MIN_DRAW_INTERVAL) revert IntervalTooShort(interval);
        drawInterval = interval;
        emit DrawIntervalUpdated(interval);
    }

    // ======================================================================
    //                            transfer mechanics
    // ======================================================================

    function _update(address from, address to, uint256 value) internal override {
        // Mints, burns, and transfers involving an exempt party go through untouched.
        bool exempt = from == address(0) || to == address(0) || isExempt[from] || isExempt[to];
        if (exempt) {
            super._update(from, to, value);
            return;
        }

        if (!tradingEnabled) revert TradingNotOpen();

        if (limitsEnabled) {
            if (value > maxTxAmount) revert ExceedsMaxTx(value, maxTxAmount);
        }

        bool lucky = _isLuckySeven(value);
        uint256 burnAmt = lucky ? 0 : (value * burnTaxBps) / 10_000;
        uint256 potAmt = lucky ? 0 : (value * jackpotTaxBps) / 10_000;
        uint256 net = value - burnAmt - potAmt;

        if (limitsEnabled) {
            uint256 resulting = balanceOf(to) + net;
            if (resulting > maxWalletAmount) revert ExceedsMaxWallet(resulting, maxWalletAmount);
        }

        if (lucky) emit LuckySeven(from, value);

        if (burnAmt > 0) {
            totalBurned += burnAmt;
            super._update(from, address(0), burnAmt);
        }
        if (potAmt > 0) super._update(from, address(this), potAmt);
        super._update(from, to, net);

        _recordTicket(from);
        taxedTransferCount += 1;
        if (taxedTransferCount % drawInterval == 0) _drawJackpot();
    }

    /// @dev Amount ends in 777 whole tokens: e.g. 777, 1777, 42777 CRZY (fractions must be zero).
    function _isLuckySeven(uint256 value) internal pure returns (bool) {
        if (value % 1e18 != 0) return false;
        return (value / 1e18) % 1000 == 777;
    }

    function _recordTicket(address sender) internal {
        _tickets[_ticketCursor] = sender;
        _ticketCursor = uint8((_ticketCursor + 1) % TICKET_RING_SIZE);
        if (_ticketCount < TICKET_RING_SIZE) _ticketCount += 1;
    }

    function _drawJackpot() internal {
        uint256 pot = balanceOf(address(this));
        if (pot == 0 || _ticketCount == 0) return;

        uint256 seed = uint256(
            keccak256(abi.encodePacked(block.prevrandao, blockhash(block.number - 1), taxedTransferCount, pot))
        );
        address winner = _tickets[seed % _ticketCount];

        // The whale cap is deliberately ignored here: winning the lottery should never revert.
        totalJackpotsPaid += pot;
        super._update(address(this), winner, pot);
        emit JackpotWon(winner, pot, taxedTransferCount / drawInterval);
    }
}
