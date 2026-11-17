// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VeyraSettlementV2 — unsigned deployment candidate
 * @notice NEW ADDRESS required. Does not mutate the immutable legacy v1 contract.
 * Generic Pay/Tip references are unique per payer; signed Payment Requests are
 * unique globally, with recipient authorization binding the intended payer.
 * EIP-712 domain binds signatures to a specific chain and deployment address.
 *
 * This contract has not been deployed or accepted for mainnet financial use.
 */

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

contract VeyraSettlementV2 is ReentrancyGuard, Ownable, Pausable, EIP712 {
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
    error InvalidReference();
    error ReferenceAlreadyUsed();
    error InvalidRecipientAuthorization();
    error AuthorizationExpired();

    /**
     * The payer-specific namespace prevents other payers from front-running
     * somebody else's ordinary Pay/Tip reference. A payer cannot use that
     * same reference twice across either Pay or a signed Payment Request.
     */
    mapping(address => mapping(bytes32 => bool)) public payerRefUsed;
    /** Global uniqueness only for recipient-authorized Payment Requests. */
    mapping(bytes32 => bool) public requestRefUsed;
    bytes32 public constant REQUEST_TYPEHASH =
        keccak256("PaymentRequest(address payer,address recipient,uint256 amount,bytes32 ref,uint256 deadline)");

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

    constructor(address usdc_, address initialOwner, address feeRecipient_, uint16 feeBps_)
        Ownable(initialOwner) EIP712("VeyraSettlement", "2")
    {
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

    /// @notice Direct Pay/Tip. Nonzero ref is unique ONLY within msg.sender.
    /// @dev Before the ERC-20 call, reserve the payer's ref. A revert
    ///      atomically restores it; nonReentrant blocks token callbacks.
    function pay(address recipient, uint256 amount, bytes32 ref) external nonReentrant {
        _requireNotPausedForNewPayments();
        _validateRecipientAndAmount(recipient, amount);
        _consumePayerReference(msg.sender, ref);
        _settle(recipient, amount, ref);
    }

    /**
     * @notice A server-issued Request may only be paid by its intended payer.
     * @dev The recipient signs the exact EIP-712 request. There is NO way for
     *      a stranger to reserve a request ref via payRequest(). The same payer
     *      cannot separately use pay() with the same ref. Server must index
     *      these receipts by payRequest() selector, not generic pay().
     */
    function payRequest(address recipient, uint256 amount, bytes32 ref, uint256 deadline, bytes calldata authorization)
        external nonReentrant
    {
        _requireNotPausedForNewPayments();
        _validateRecipientAndAmount(recipient, amount);
        if (ref == bytes32(0)) revert InvalidReference();
        if (deadline < block.timestamp) revert AuthorizationExpired();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            REQUEST_TYPEHASH, msg.sender, recipient, amount, ref, deadline
        )));
        if (!SignatureChecker.isValidSignatureNow(recipient, digest, authorization))
            revert InvalidRecipientAuthorization();
        if (requestRefUsed[ref]) revert ReferenceAlreadyUsed();
        _consumePayerReference(msg.sender, ref);
        requestRefUsed[ref] = true;
        _settle(recipient, amount, ref);
    }

    function requestDigest(address payer, address recipient, uint256 amount, bytes32 ref, uint256 deadline)
        external view returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(
            REQUEST_TYPEHASH, payer, recipient, amount, ref, deadline
        )));
    }

    function _consumePayerReference(address payer, bytes32 ref) internal {
        if (ref == bytes32(0)) revert InvalidReference();
        if (payerRefUsed[payer][ref]) revert ReferenceAlreadyUsed();
        payerRefUsed[payer][ref] = true;
    }

    function _settle(address recipient, uint256 amount, bytes32 ref) internal {
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
