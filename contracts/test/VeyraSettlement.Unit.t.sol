// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VeyraSettlementTestBase} from "./VeyraSettlement.Base.t.sol";
import {VeyraSettlement} from "../VeyraSettlement.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract VeyraSettlementUnitTest is VeyraSettlementTestBase {

    // ════════════════════════════════════════════════════════════════════════
    // 1. Deployment & initialisation
    // ════════════════════════════════════════════════════════════════════════

    function test_Deploy_StorageCorrect() public view {
        assertEq(address(settlement.usdc()), address(usdc));
        assertEq(settlement.owner(), owner);
        assertEq(settlement.feeRecipient(), owner);
        assertEq(settlement.feeBps(), uint16(FEE_BPS));
        assertEq(settlement.accruedFees(), 0);
        assertEq(settlement.hasPendingFeeConfig(), false);
        assertEq(settlement.escrowCount(), 0);
    }

    function test_Deploy_ZeroFee_StorageCorrect() public view {
        assertEq(settlementZ.feeBps(), 0);
        assertEq(settlementZ.feeRecipient(), address(0));
    }

    function test_Deploy_RevertIf_ZeroUSDC() public {
        vm.expectRevert(VeyraSettlement.ZeroAddress.selector);
        new VeyraSettlement(address(0), owner, owner, 0);
    }

    function test_Deploy_RevertIf_ZeroOwner() public {
        // OZ Ownable constructor fires OwnableInvalidOwner before our ZeroAddress check.
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0))
        );
        new VeyraSettlement(address(usdc), address(0), owner, 0);
    }

    function test_Deploy_RevertIf_FeeTooHigh() public {
        vm.expectRevert(VeyraSettlement.InvalidFeeBps.selector);
        new VeyraSettlement(address(usdc), owner, owner, 101);
    }

    function test_Deploy_RevertIf_FeeRecipientZeroWithNonZeroFee() public {
        vm.expectRevert(VeyraSettlement.ZeroAddress.selector);
        new VeyraSettlement(address(usdc), owner, address(0), 50);
    }

    // ════════════════════════════════════════════════════════════════════════
    // 2. Happy path — pay()
    // ════════════════════════════════════════════════════════════════════════

    /// @dev Cleaner pay test: verify balances and accruedFees directly.
    function test_Pay_RecipientReceivesNetAmount() public {
        (uint256 fee, uint256 net) = _feeAndNet(AMOUNT);

        uint256 recipBefore = usdc.balanceOf(recipient);
        uint256 contractBefore = usdc.balanceOf(address(settlement));
        uint256 payerBefore = usdc.balanceOf(payer);

        vm.prank(payer);
        settlement.pay(recipient, AMOUNT, bytes32(0));

        assertEq(usdc.balanceOf(recipient),          recipBefore + net,    "recipient net");
        assertEq(usdc.balanceOf(payer),              payerBefore - AMOUNT, "payer debited");
        assertEq(settlement.accruedFees(),           fee,                  "accruedFees");
        // Contract only holds the accrued fee (net was forwarded)
        assertEq(usdc.balanceOf(address(settlement)), contractBefore + fee, "contract holds fee");
    }

    function test_Pay_EmitsPaymentCreatedAndSettled() public {
        (uint256 fee,) = _feeAndNet(AMOUNT);

        vm.startPrank(payer);

        // PaymentCreated: check payer + recipient indexed, data=amount,ref,escrow=false
        vm.expectEmit(false, true, true, true, address(settlement));
        emit VeyraSettlement.PaymentCreated(bytes32(0), payer, recipient, AMOUNT, bytes32(0), false);

        // PaymentSettled: check payer + recipient indexed
        vm.expectEmit(false, true, true, true, address(settlement));
        emit VeyraSettlement.PaymentSettled(bytes32(0), payer, recipient, AMOUNT, fee, bytes32(0));

        settlement.pay(recipient, AMOUNT, bytes32(0));
        vm.stopPrank();
    }

    function test_Pay_SetsPaymentStateReleased() public {
        vm.prank(payer);
        bytes32 id = _getPaymentId(payer, recipient, AMOUNT, 0);
        settlement.pay(recipient, AMOUNT, bytes32(0));
        assertEq(uint8(settlement.paymentStates(id)), uint8(VeyraSettlement.PaymentState.RELEASED));
    }

    // ════════════════════════════════════════════════════════════════════════
    // 3. Happy path — createEscrow → releaseEscrow (by recipient)
    // ════════════════════════════════════════════════════════════════════════

    function test_CreateEscrow_SetsState() public {
        bytes32 id = _createEscrow(AMOUNT, TIMEOUT);
        VeyraSettlement.Escrow memory e = settlement.getEscrow(id);

        assertEq(e.payer,     payer,     "payer");
        assertEq(e.recipient, recipient, "recipient");
        assertEq(e.amount,    AMOUNT,    "amount");
        assertEq(uint8(e.state), uint8(VeyraSettlement.EscrowState.ACTIVE));
        assertGt(e.expiresAt, block.timestamp);
        assertEq(uint8(settlement.paymentStates(id)), uint8(VeyraSettlement.PaymentState.PENDING));
    }

    function test_CreateEscrow_ContractHoldsTokens() public {
        uint256 contractBefore = usdc.balanceOf(address(settlement));
        _createEscrow(AMOUNT, TIMEOUT);
        assertEq(usdc.balanceOf(address(settlement)), contractBefore + AMOUNT);
    }

    function test_CreateEscrow_EmitsEvents() public {
        vm.startPrank(payer);
        vm.expectEmit(false, true, true, true, address(settlement));
        emit VeyraSettlement.PaymentCreated(bytes32(0), payer, recipient, AMOUNT, bytes32(0), true);
        vm.expectEmit(false, true, true, false, address(settlement));
        emit VeyraSettlement.EscrowCreated(bytes32(0), payer, recipient, AMOUNT, 0, bytes32(0));
        settlement.createEscrow(recipient, AMOUNT, TIMEOUT, bytes32(0));
        vm.stopPrank();
    }

    function test_ReleaseEscrow_ByRecipient_HappyPath() public {
        (uint256 fee, uint256 net) = _feeAndNet(AMOUNT);
        bytes32 id = _createEscrow(AMOUNT, TIMEOUT);

        uint256 recipBefore = usdc.balanceOf(recipient);

        vm.prank(recipient);
        vm.expectEmit(false, true, true, true, address(settlement));
        emit VeyraSettlement.EscrowReleased(id, payer, recipient, AMOUNT, fee);
        settlement.releaseEscrow(id);

        assertEq(usdc.balanceOf(recipient), recipBefore + net, "recipient net");
        assertEq(settlement.accruedFees(),  fee,               "fee accrued");
        assertEq(uint8(settlement.paymentStates(id)), uint8(VeyraSettlement.PaymentState.RELEASED));
    }

    // ════════════════════════════════════════════════════════════════════════
    // 4. Happy path — createEscrow → releaseEscrow (by payer)
    // ════════════════════════════════════════════════════════════════════════

    function test_ReleaseEscrow_ByPayer_HappyPath() public {
        (uint256 fee, uint256 net) = _feeAndNet(AMOUNT);
        bytes32 id = _createEscrow(AMOUNT, TIMEOUT);

        uint256 recipBefore = usdc.balanceOf(recipient);

        vm.prank(payer);
        settlement.releaseEscrow(id);

        assertEq(usdc.balanceOf(recipient), recipBefore + net, "payer-initiated: recipient net");
        assertEq(settlement.accruedFees(),  fee,               "payer-initiated: fee accrued");
    }

    // ════════════════════════════════════════════════════════════════════════
    // 5. Happy path — createEscrow → refundEscrow (by payer, after expiry)
    // ════════════════════════════════════════════════════════════════════════

    function test_RefundEscrow_HappyPath() public {
        bytes32 id = _createEscrow(AMOUNT, TIMEOUT);
        uint256 payerBefore = usdc.balanceOf(payer);

        // Advance past expiry
        vm.warp(block.timestamp + TIMEOUT + 1);

        vm.prank(payer);
        vm.expectEmit(false, true, false, true, address(settlement));
        emit VeyraSettlement.EscrowRefunded(id, payer, AMOUNT);
        settlement.refundEscrow(id);

        assertEq(usdc.balanceOf(payer), payerBefore + AMOUNT, "full refund to payer");
        assertEq(settlement.accruedFees(), 0, "no fee on refund");
        assertEq(uint8(settlement.paymentStates(id)), uint8(VeyraSettlement.PaymentState.REFUNDED));
    }

    // ════════════════════════════════════════════════════════════════════════
    // 6. Revert paths
    // ════════════════════════════════════════════════════════════════════════

    function test_Revert_Pay_ZeroAddress() public {
        vm.prank(payer);
        vm.expectRevert(VeyraSettlement.ZeroAddress.selector);
        settlement.pay(address(0), AMOUNT, bytes32(0));
    }

    function test_Revert_Pay_ZeroAmount() public {
        vm.prank(payer);
        vm.expectRevert(VeyraSettlement.InvalidAmount.selector);
        settlement.pay(recipient, 0, bytes32(0));
    }

    function test_Revert_CreateEscrow_TimeoutTooShort() public {
        vm.prank(payer);
        vm.expectRevert(VeyraSettlement.InvalidTimeout.selector);
        settlement.createEscrow(recipient, AMOUNT, 59 minutes, bytes32(0));
    }

    function test_Revert_CreateEscrow_TimeoutTooLong() public {
        vm.prank(payer);
        vm.expectRevert(VeyraSettlement.InvalidTimeout.selector);
        settlement.createEscrow(recipient, AMOUNT, 30 days + 1, bytes32(0));
    }

    function test_Revert_CreateEscrow_ExactMinTimeout_OK() public {
        vm.prank(payer);
        bytes32 id = settlement.createEscrow(recipient, AMOUNT, 1 hours, bytes32(0));
        assertTrue(id != bytes32(0));
    }

    function test_Revert_CreateEscrow_ExactMaxTimeout_OK() public {
        vm.prank(payer);
        bytes32 id = settlement.createEscrow(recipient, AMOUNT, 30 days, bytes32(0));
        assertTrue(id != bytes32(0));
    }

    function test_Revert_ReleaseEscrow_AfterExpiry() public {
        bytes32 id = _createEscrow(AMOUNT, TIMEOUT);
        VeyraSettlement.Escrow memory e = settlement.getEscrow(id);

        // Warp to exactly expiresAt (boundary: block.timestamp >= expiresAt → EscrowExpired)
        vm.warp(e.expiresAt);

        vm.prank(recipient);
        vm.expectRevert(VeyraSettlement.EscrowExpired.selector);
        settlement.releaseEscrow(id);
    }

    function test_Revert_RefundEscrow_BeforeExpiry() public {
        bytes32 id = _createEscrow(AMOUNT, TIMEOUT);
        VeyraSettlement.Escrow memory e = settlement.getEscrow(id);

        // One second before expiry → EscrowNotExpired
        vm.warp(e.expiresAt - 1);

        vm.prank(payer);
        vm.expectRevert(VeyraSettlement.EscrowNotExpired.selector);
        settlement.refundEscrow(id);
    }

    function test_Revert_ReleaseEscrow_ByStranger() public {
        bytes32 id = _createEscrow(AMOUNT, TIMEOUT);

        vm.prank(stranger);
        vm.expectRevert(VeyraSettlement.NotParticipant.selector);
        settlement.releaseEscrow(id);
    }

    function test_Revert_RefundEscrow_ByRecipient() public {
        bytes32 id = _createEscrow(AMOUNT, TIMEOUT);
        vm.warp(block.timestamp + TIMEOUT + 1);

        vm.prank(recipient);
        vm.expectRevert(VeyraSettlement.NotParticipant.selector);
        settlement.refundEscrow(id);
    }

    // ════════════════════════════════════════════════════════════════════════
    // 7. Double-settlement prevention
    // ════════════════════════════════════════════════════════════════════════

    function test_Revert_ReleaseEscrow_AlreadyReleased() public {
        bytes32 id = _createEscrow(AMOUNT, TIMEOUT);

        vm.prank(recipient);
        settlement.releaseEscrow(id);

        vm.prank(payer);
        vm.expectRevert(VeyraSettlement.PaymentAlreadySettled.selector);
        settlement.releaseEscrow(id);
    }

    function test_Revert_RefundEscrow_AlreadyRefunded() public {
        bytes32 id = _createEscrow(AMOUNT, TIMEOUT);
        vm.warp(block.timestamp + TIMEOUT + 1);

        vm.prank(payer);
        settlement.refundEscrow(id);

        vm.prank(payer);
        vm.expectRevert(VeyraSettlement.PaymentAlreadySettled.selector);
        settlement.refundEscrow(id);
    }

    function test_Revert_RefundAfterRelease() public {
        bytes32 id = _createEscrow(AMOUNT, TIMEOUT);
        vm.prank(payer);
        settlement.releaseEscrow(id);

        vm.warp(block.timestamp + TIMEOUT + 1);
        vm.prank(payer);
        vm.expectRevert(VeyraSettlement.PaymentAlreadySettled.selector);
        settlement.refundEscrow(id);
    }

    // ════════════════════════════════════════════════════════════════════════
    // 8. Fee accounting (feeBps=100, 1%)
    // ════════════════════════════════════════════════════════════════════════

    function test_Fee_PayExact() public {
        uint256 expectedFee = AMOUNT / 100;
        uint256 expectedNet = AMOUNT - expectedFee;

        vm.prank(payer);
        settlement.pay(recipient, AMOUNT, bytes32(0));

        assertEq(settlement.accruedFees(), expectedFee, "accruedFees");
        assertEq(usdc.balanceOf(recipient), expectedNet, "recipient net");
    }

    function test_Fee_EscrowRelease() public {
        uint256 expectedFee = AMOUNT / 100;
        uint256 expectedNet = AMOUNT - expectedFee;

        bytes32 id = _createEscrow(AMOUNT, TIMEOUT);

        assertEq(settlement.accruedFees(), 0, "no fee yet");

        vm.prank(recipient);
        settlement.releaseEscrow(id);

        assertEq(settlement.accruedFees(), expectedFee, "fee after release");
        assertEq(usdc.balanceOf(recipient), expectedNet, "recipient net");
    }

    function test_Fee_AccumulatesAcrossPayments() public {
        uint256 feePerPayment = AMOUNT / 100;

        for (uint256 i = 0; i < 3; i++) {
            vm.prank(payer);
            settlement.pay(recipient, AMOUNT, bytes32(0));
        }

        assertEq(settlement.accruedFees(), feePerPayment * 3, "accumulated fees");
    }

    // ════════════════════════════════════════════════════════════════════════
    // 9. Zero fee (feeBps=0)
    // ════════════════════════════════════════════════════════════════════════

    function test_ZeroFee_Pay_FullAmountToRecipient() public {
        uint256 recipBefore = usdc.balanceOf(recipient);

        vm.prank(payer);
        settlementZ.pay(recipient, AMOUNT, bytes32(0));

        assertEq(usdc.balanceOf(recipient), recipBefore + AMOUNT, "full amount");
        assertEq(settlementZ.accruedFees(), 0, "no fees");
    }

    function test_ZeroFee_EscrowRelease_FullAmountToRecipient() public {
        uint256 recipBefore = usdc.balanceOf(recipient);
        bytes32 id = _createEscrowZ(AMOUNT, TIMEOUT);

        vm.prank(recipient);
        settlementZ.releaseEscrow(id);

        assertEq(usdc.balanceOf(recipient), recipBefore + AMOUNT, "full amount");
        assertEq(settlementZ.accruedFees(), 0, "no fees");
    }

    // ════════════════════════════════════════════════════════════════════════
    // 10. withdrawFees
    // ════════════════════════════════════════════════════════════════════════

    function test_WithdrawFees_OwnerCanWithdraw() public {
        uint256 expectedFee = AMOUNT / 100;

        vm.prank(payer);
        settlement.pay(recipient, AMOUNT, bytes32(0));

        uint256 ownerBefore = usdc.balanceOf(owner);

        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(settlement));
        emit VeyraSettlement.FeesWithdrawn(owner, expectedFee);
        settlement.withdrawFees(owner);

        assertEq(usdc.balanceOf(owner),     ownerBefore + expectedFee, "owner received fees");
        assertEq(settlement.accruedFees(),  0,                          "accruedFees zeroed");
    }

    function test_WithdrawFees_ToArbitraryAddress() public {
        vm.prank(payer);
        settlement.pay(recipient, AMOUNT, bytes32(0));
        uint256 expectedFee = AMOUNT / 100;

        address treasury = makeAddr("treasury");

        vm.prank(owner);
        settlement.withdrawFees(treasury);

        assertEq(usdc.balanceOf(treasury), expectedFee, "treasury received fees");
    }

    function test_WithdrawFees_ZeroAccrued_EmitsZeroAmount() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(settlement));
        emit VeyraSettlement.FeesWithdrawn(owner, 0);
        settlement.withdrawFees(owner); // amount=0 → no transfer, but event still emitted
        assertEq(settlement.accruedFees(), 0);
    }

    function test_WithdrawFees_NonOwner_Reverts() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        settlement.withdrawFees(stranger);
    }

    function test_WithdrawFees_ZeroAddress_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(VeyraSettlement.ZeroAddress.selector);
        settlement.withdrawFees(address(0));
    }

    // ════════════════════════════════════════════════════════════════════════
    // 11. Pause behaviour
    // ════════════════════════════════════════════════════════════════════════

    function test_Pause_Pay_Reverts() public {
        vm.prank(owner);
        settlement.pause();

        vm.prank(payer);
        vm.expectRevert(VeyraSettlement.ContractPaused.selector);
        settlement.pay(recipient, AMOUNT, bytes32(0));
    }

    function test_Pause_CreateEscrow_Reverts() public {
        vm.prank(owner);
        settlement.pause();

        vm.prank(payer);
        vm.expectRevert(VeyraSettlement.ContractPaused.selector);
        settlement.createEscrow(recipient, AMOUNT, TIMEOUT, bytes32(0));
    }

    function test_Pause_ReleaseEscrow_StillWorks() public {
        bytes32 id = _createEscrow(AMOUNT, TIMEOUT);

        vm.prank(owner);
        settlement.pause();

        vm.prank(recipient);
        settlement.releaseEscrow(id); // must NOT revert
        assertEq(uint8(settlement.paymentStates(id)), uint8(VeyraSettlement.PaymentState.RELEASED));
    }

    function test_Pause_RefundEscrow_StillWorks() public {
        bytes32 id = _createEscrow(AMOUNT, TIMEOUT);
        vm.warp(block.timestamp + TIMEOUT + 1);

        vm.prank(owner);
        settlement.pause();

        vm.prank(payer);
        settlement.refundEscrow(id); // must NOT revert
        assertEq(uint8(settlement.paymentStates(id)), uint8(VeyraSettlement.PaymentState.REFUNDED));
    }

    function test_Unpause_AllowsNewPayments() public {
        vm.prank(owner);
        settlement.pause();

        vm.prank(owner);
        settlement.unpause();

        vm.prank(payer);
        settlement.pay(recipient, AMOUNT, bytes32(0)); // must succeed
    }

    function test_Pause_NonOwner_Reverts() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        settlement.pause();
    }

    // ════════════════════════════════════════════════════════════════════════
    // 12. renounceOwnership
    // ════════════════════════════════════════════════════════════════════════

    function test_RenounceOwnership_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(VeyraSettlement.RenounceOwnershipDisabled.selector);
        settlement.renounceOwnership();
    }

    // ════════════════════════════════════════════════════════════════════════
    // 13. queueFeeConfig + applyFeeConfig
    // ════════════════════════════════════════════════════════════════════════

    function test_QueueFeeConfig_StoresValues() public {
        address newRecipient = makeAddr("newRecipient");
        uint16  newBps       = 50;

        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(settlement));
        emit VeyraSettlement.FeeConfigQueued(newRecipient, newBps, block.timestamp + 24 hours);
        settlement.queueFeeConfig(newRecipient, newBps);

        assertTrue(settlement.hasPendingFeeConfig());
        (address r, uint16 b, uint256 a) = settlement.pendingFeeConfig();
        assertEq(r, newRecipient);
        assertEq(b, newBps);
        assertEq(a, block.timestamp + 24 hours);
    }

    function test_ApplyFeeConfig_RevertsBeforeDelay() public {
        address newRecipient = makeAddr("newRecipient");

        vm.prank(owner);
        settlement.queueFeeConfig(newRecipient, 50);

        // One second short of 24 h
        vm.warp(block.timestamp + 24 hours - 1);

        vm.prank(owner);
        vm.expectRevert(VeyraSettlement.InvalidTimeout.selector);
        settlement.applyFeeConfig();
    }

    function test_ApplyFeeConfig_AfterDelay_UpdatesState() public {
        address newRecipient = makeAddr("newRecipient");
        uint16  newBps       = 50;

        vm.prank(owner);
        settlement.queueFeeConfig(newRecipient, newBps);

        vm.warp(block.timestamp + 24 hours);

        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(settlement));
        emit VeyraSettlement.FeeConfigUpdated(newRecipient, newBps);
        settlement.applyFeeConfig();

        assertEq(settlement.feeRecipient(), newRecipient, "feeRecipient updated");
        assertEq(settlement.feeBps(),       newBps,       "feeBps updated");
        assertFalse(settlement.hasPendingFeeConfig(),     "pending cleared");
    }

    function test_ApplyFeeConfig_NoPending_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(VeyraSettlement.InvalidFeeBps.selector);
        settlement.applyFeeConfig();
    }

    // ════════════════════════════════════════════════════════════════════════
    // 14. cancelFeeConfig
    // ════════════════════════════════════════════════════════════════════════

    function test_CancelFeeConfig_ClearsPending() public {
        address newRecipient = makeAddr("newRecipient");

        vm.prank(owner);
        settlement.queueFeeConfig(newRecipient, 50);
        assertTrue(settlement.hasPendingFeeConfig());

        vm.prank(owner);
        settlement.cancelFeeConfig();
        assertFalse(settlement.hasPendingFeeConfig(), "pending cleared");
    }

    function test_CancelFeeConfig_NonOwner_Reverts() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        settlement.cancelFeeConfig();
    }

    // ════════════════════════════════════════════════════════════════════════
    // 15. escrowCount increments
    // ════════════════════════════════════════════════════════════════════════

    function test_EscrowCount_Increments() public {
        assertEq(settlement.escrowCount(), 0);
        _createEscrow(AMOUNT, TIMEOUT);
        assertEq(settlement.escrowCount(), 1);
        _createEscrow(AMOUNT, TIMEOUT);
        assertEq(settlement.escrowCount(), 2);
    }

    // ════════════════════════════════════════════════════════════════════════
    // Internal helper — replicate _nextPaymentId to predict an id in tests
    // ════════════════════════════════════════════════════════════════════════

    /// @dev Pre-computes the paymentId that the contract will emit for a pay()
    ///      given current block.timestamp and current nonce (0-based).
    function _getPaymentId(address p, address r, uint256 a, uint256 nonce)
        internal
        view
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(p, r, a, block.timestamp, nonce));
    }
}
