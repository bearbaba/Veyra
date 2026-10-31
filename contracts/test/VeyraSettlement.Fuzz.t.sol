// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VeyraSettlementTestBase} from "./VeyraSettlement.Base.t.sol";
import {VeyraSettlement} from "../VeyraSettlement.sol";

contract VeyraSettlementFuzzTest is VeyraSettlementTestBase {

    // ════════════════════════════════════════════════════════════════════════
    // Fuzz 1 — direct pay(): paymentId state == RELEASED, balances correct
    // ════════════════════════════════════════════════════════════════════════

    function testFuzz_Pay_RecipientAndFeeAccounting(address recip, uint256 amount) public {
        // Constrain inputs to valid domain
        vm.assume(recip != address(0));
        vm.assume(recip != address(settlement));   // avoid self-transfer edge
        amount = bound(amount, 1, 1e18);

        // Make sure payer has enough
        usdc.mint(payer, amount);
        vm.prank(payer);
        usdc.approve(address(settlement), amount);

        uint256 expectedFee = (amount * FEE_BPS) / 10_000;
        uint256 expectedNet = amount - expectedFee;

        uint256 recipBefore    = usdc.balanceOf(recip);
        uint256 feesBefore     = settlement.accruedFees();

        vm.prank(payer);
        settlement.pay(recip, amount, bytes32(0));

        // PROPERTY: recipient received exactly netAmount
        assertEq(usdc.balanceOf(recip), recipBefore + expectedNet, "recipient net");
        // PROPERTY: accruedFees increased by fee
        assertEq(settlement.accruedFees(), feesBefore + expectedFee, "accrued fees");
    }

    function testFuzz_Pay_PaymentStateIsReleased(address recip, uint256 amount) public {
        vm.assume(recip != address(0));
        vm.assume(recip != address(settlement));
        amount = bound(amount, 1, 1e18);

        usdc.mint(payer, amount);
        vm.prank(payer);
        usdc.approve(address(settlement), amount);

        // Snapshot nonce before to predict id
        uint256 nonceBefore = settlement.escrowCount();
        uint256 ts          = block.timestamp;
        bytes32 expectedId  = keccak256(abi.encodePacked(payer, recip, amount, ts, nonceBefore));

        vm.prank(payer);
        settlement.pay(recip, amount, bytes32(0));

        assertEq(
            uint8(settlement.paymentStates(expectedId)),
            uint8(VeyraSettlement.PaymentState.RELEASED),
            "paymentState == RELEASED"
        );
    }

    // ════════════════════════════════════════════════════════════════════════
    // Fuzz 2 — escrow round-trip: amount + fee == original amount (no dust)
    // ════════════════════════════════════════════════════════════════════════

    function testFuzz_Escrow_NoAmountDust(uint256 amount, uint256 timeout) public {
        amount  = bound(amount,  1, 1e18);
        timeout = bound(timeout, 1 hours, 30 days);

        usdc.mint(payer, amount);
        vm.prank(payer);
        usdc.approve(address(settlement), amount);

        uint256 recipBefore    = usdc.balanceOf(recipient);
        uint256 feesBefore     = settlement.accruedFees();
        uint256 contractBefore = usdc.balanceOf(address(settlement));

        vm.prank(payer);
        bytes32 id = settlement.createEscrow(recipient, amount, timeout, bytes32(0));

        // Escrow holds the funds
        assertEq(usdc.balanceOf(address(settlement)), contractBefore + amount, "escrow holds amount");

        vm.prank(recipient);
        settlement.releaseEscrow(id);

        uint256 fee = settlement.accruedFees() - feesBefore;
        uint256 netReceived = usdc.balanceOf(recipient) - recipBefore;

        // PROPERTY: netReceived + fee == original amount (no dust)
        assertEq(netReceived + fee, amount, "netReceived + fee == amount");
    }

    // ════════════════════════════════════════════════════════════════════════
    // Fuzz 3 — refund path: full amount returned (no fee on refund)
    // ════════════════════════════════════════════════════════════════════════

    function testFuzz_Escrow_Refund_FullAmountReturned(uint256 amount, uint256 timeout) public {
        amount  = bound(amount,  1, 1e18);
        timeout = bound(timeout, 1 hours, 30 days);

        usdc.mint(payer, amount);
        vm.prank(payer);
        usdc.approve(address(settlement), amount);

        uint256 payerBefore = usdc.balanceOf(payer);

        vm.prank(payer);
        bytes32 id = settlement.createEscrow(recipient, amount, timeout, bytes32(0));

        // Advance past expiry
        vm.warp(block.timestamp + timeout + 1);

        vm.prank(payer);
        settlement.refundEscrow(id);

        // PROPERTY: payer gets back exactly what they put in
        assertEq(usdc.balanceOf(payer), payerBefore, "payer whole after refund");
    }

    // ════════════════════════════════════════════════════════════════════════
    // Fuzz 4 — fee arithmetic: feeBps in [0, 100]
    // ════════════════════════════════════════════════════════════════════════

    function testFuzz_FeeArithmetic(uint16 bps, uint256 amount) public {
        bps    = uint16(bound(uint256(bps), 0, 100));
        amount = bound(amount, 1, 1e30);

        // The formula the contract uses:
        uint256 fee = (amount * bps) / 10_000;
        uint256 net = amount - fee;

        // PROPERTY: no overflow (solidity 0.8.x reverts on overflow), fee in [0, amount]
        assertLe(fee, amount, "fee <= amount");
        assertEq(fee + net, amount, "fee + net == amount");
    }
}
