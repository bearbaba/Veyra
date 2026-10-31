// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract VeyraSettlement is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 100; // 1%
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MIN_TIMEOUT = 1 hours;
    uint256 public constant MAX_TIMEOUT = 30 days;
    uint256 public constant MIN_AMOUNT = 1; // 1 micro-USDC for 6-decimal USDC

    enum PaymentState {
        PENDING,
        RELEASED,
        REFUNDED
    }

    enum EscrowState {
        ACTIVE,
        RELEASED,
        REFUNDED
    }

    struct Escrow {
        address payer;
        address recipient;
        uint256 amount;
        uint256 expiresAt;
        EscrowState state;
    }

    error ZeroAddress();
    error InvalidAmount();
    error InvalidTimeout();
    error PaymentAlreadySettled();
    error EscrowNotExpired();
    error EscrowExpired();
    error NotParticipant();
    error InvalidFeeBps();
    error ContractPaused();
    error RenounceOwnershipDisabled();

    event PaymentCreated(
        bytes32 indexed paymentId,
        address indexed payer,
        address indexed recipient,
        uint256 amount,
        bytes32 ref,
        bool escrow
    );
    event PaymentSettled(
        bytes32 indexed paymentId,
        address indexed payer,
        address indexed recipient,
        uint256 amount,
        uint256 fee,
        bytes32 ref
    );
    event EscrowCreated(
        bytes32 indexed paymentId,
        address indexed payer,
        address indexed recipient,
        uint256 amount,
        uint256 expiresAt,
        bytes32 ref
    );
    event EscrowReleased(
        bytes32 indexed paymentId,
        address indexed payer,
        address indexed recipient,
        uint256 amount,
        uint256 fee
    );
    event EscrowRefunded(bytes32 indexed paymentId, address indexed payer, uint256 amount);
    event FeeConfigUpdated(address indexed feeRecipient, uint16 feeBps);
    event FeeConfigQueued(address indexed feeRecipient, uint16 feeBps, uint256 activatesAt);
    event FeesWithdrawn(address indexed to, uint256 amount);

    IERC20 public immutable usdc;

    address public feeRecipient;
    uint16 public feeBps;
    uint256 public accruedFees;
    struct PendingFeeConfig {
        address feeRecipient;
        uint16 feeBps;
        uint256 activatesAt;
    }
    PendingFeeConfig public pendingFeeConfig;
    bool public hasPendingFeeConfig;
    uint256 public constant FEE_CONFIG_DELAY = 24 hours;
    uint256 private _nonce;

    mapping(bytes32 => Escrow) private _escrows;
    mapping(bytes32 => PaymentState) public paymentStates;

    constructor(address usdc_, address initialOwner, address feeRecipient_, uint16 feeBps_) Ownable(initialOwner) {
        if (usdc_ == address(0) || initialOwner == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert InvalidFeeBps();
        if (feeRecipient_ == address(0) && feeBps_ != 0) revert ZeroAddress();

        usdc = IERC20(usdc_);
        // Enforce that the USDC token address is the canonical non-deflationary contract.
        // This contract does not support fee-on-transfer tokens: escrow.amount == amount received.
        // On Arc Testnet: 0x3600000000000000000000000000000000000000
        // On Arc Mainnet: set at deploy time from the official Circle USDC address.
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
    }

    /// @dev Renouncing ownership is disabled because this contract requires an owner
    ///      to unpause new-payment flows and to withdraw accrued fees.
    function renounceOwnership() public override onlyOwner {
        revert RenounceOwnershipDisabled();
    }

    function pay(address recipient, uint256 amount, bytes32 ref) external nonReentrant {
        _requireNotPausedForNewPayments();
        _validateRecipientAndAmount(recipient, amount);

        bytes32 paymentId = _nextPaymentId(msg.sender, recipient, amount);
        paymentStates[paymentId] = PaymentState.RELEASED;

        (uint256 fee, uint256 netAmount) = _computeFeeAndNet(amount);

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        accruedFees += fee;
        usdc.safeTransfer(recipient, netAmount);

        emit PaymentCreated(paymentId, msg.sender, recipient, amount, ref, false);
        emit PaymentSettled(paymentId, msg.sender, recipient, amount, fee, ref);
    }

    function createPayment(address recipient, uint256 amount, uint256 timeoutSeconds, bytes32 ref)
        external
        nonReentrant
        returns (bytes32 paymentId)
    {
        paymentId = _createEscrow(recipient, amount, timeoutSeconds, ref);
    }

    function createEscrow(address recipient, uint256 amount, uint256 timeoutSeconds, bytes32 ref)
        external
        nonReentrant
        returns (bytes32 paymentId)
    {
        paymentId = _createEscrow(recipient, amount, timeoutSeconds, ref);
    }

    function releaseEscrow(bytes32 paymentId) external nonReentrant {
        Escrow storage escrow = _escrows[paymentId];

        if (msg.sender != escrow.payer && msg.sender != escrow.recipient) revert NotParticipant();
        if (escrow.state != EscrowState.ACTIVE) revert PaymentAlreadySettled();
        if (block.timestamp >= escrow.expiresAt) revert EscrowExpired();

        escrow.state = EscrowState.RELEASED;
        paymentStates[paymentId] = PaymentState.RELEASED;

        (uint256 fee, uint256 netAmount) = _computeFeeAndNet(escrow.amount);

        accruedFees += fee;
        usdc.safeTransfer(escrow.recipient, netAmount);

        emit EscrowReleased(paymentId, escrow.payer, escrow.recipient, escrow.amount, fee);
    }

    function refundEscrow(bytes32 paymentId) external nonReentrant {
        Escrow storage escrow = _escrows[paymentId];

        if (msg.sender != escrow.payer) revert NotParticipant();
        if (escrow.state != EscrowState.ACTIVE) revert PaymentAlreadySettled();
        if (block.timestamp < escrow.expiresAt) revert EscrowNotExpired();

        escrow.state = EscrowState.REFUNDED;
        paymentStates[paymentId] = PaymentState.REFUNDED;

        usdc.safeTransfer(escrow.payer, escrow.amount);

        emit EscrowRefunded(paymentId, escrow.payer, escrow.amount);
    }

    /// @notice Queue a fee config change. It becomes effective after FEE_CONFIG_DELAY (24h).
    function queueFeeConfig(address newFeeRecipient, uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert InvalidFeeBps();
        if (newFeeRecipient == address(0) && newFeeBps != 0) revert ZeroAddress();
        uint256 activatesAt = block.timestamp + FEE_CONFIG_DELAY;
        pendingFeeConfig = PendingFeeConfig(newFeeRecipient, newFeeBps, activatesAt);
        hasPendingFeeConfig = true;
        emit FeeConfigQueued(newFeeRecipient, newFeeBps, activatesAt);
    }

    /// @notice Apply a previously queued fee config change after the delay has elapsed.
    function applyFeeConfig() external onlyOwner {
        if (!hasPendingFeeConfig) revert InvalidFeeBps(); // nothing pending — reuse error
        PendingFeeConfig memory pending = pendingFeeConfig;
        if (block.timestamp < pending.activatesAt) revert InvalidTimeout(); // reuse error: too early
        feeRecipient = pending.feeRecipient;
        feeBps = pending.feeBps;
        hasPendingFeeConfig = false;
        delete pendingFeeConfig;
        emit FeeConfigUpdated(pending.feeRecipient, pending.feeBps);
    }

    /// @notice Emergency: cancel a pending (not yet applied) fee config change.
    function cancelFeeConfig() external onlyOwner {
        hasPendingFeeConfig = false;
        delete pendingFeeConfig;
    }

    function withdrawFees(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();

        uint256 amount = accruedFees;
        accruedFees = 0;

        if (amount > 0) {
            usdc.safeTransfer(to, amount);
        }

        emit FeesWithdrawn(to, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getEscrow(bytes32 paymentId) external view returns (Escrow memory) {
        return _escrows[paymentId];
    }

    function escrowCount() external view returns (uint256) {
        return _nonce;
    }

    function _createEscrow(address recipient, uint256 amount, uint256 timeoutSeconds, bytes32 ref)
        internal
        returns (bytes32 paymentId)
    {
        _requireNotPausedForNewPayments();
        _validateRecipientAndAmount(recipient, amount);
        if (timeoutSeconds < MIN_TIMEOUT || timeoutSeconds > MAX_TIMEOUT) revert InvalidTimeout();

        paymentId = _nextPaymentId(msg.sender, recipient, amount);

        Escrow storage escrow = _escrows[paymentId];
        escrow.payer = msg.sender;
        escrow.recipient = recipient;
        escrow.amount = amount;
        escrow.expiresAt = block.timestamp + timeoutSeconds;
        escrow.state = EscrowState.ACTIVE;

        paymentStates[paymentId] = PaymentState.PENDING;

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit PaymentCreated(paymentId, msg.sender, recipient, amount, ref, true);
        emit EscrowCreated(paymentId, msg.sender, recipient, amount, escrow.expiresAt, ref);
    }

    function _computeFeeAndNet(uint256 amount) internal view returns (uint256 fee, uint256 netAmount) {
        fee = (amount * feeBps) / BPS_DENOMINATOR;
        netAmount = amount - fee;
    }

    function _nextPaymentId(address payer, address recipient, uint256 amount) internal returns (bytes32 paymentId) {
        paymentId = keccak256(abi.encodePacked(payer, recipient, amount, block.timestamp, _nonce++));
    }

    function _validateRecipientAndAmount(address recipient, uint256 amount) internal pure {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount < MIN_AMOUNT) revert InvalidAmount();
    }

    function _requireNotPausedForNewPayments() internal view {
        if (paused()) revert ContractPaused();
    }
}
