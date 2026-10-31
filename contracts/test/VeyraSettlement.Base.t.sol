// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {VeyraSettlement} from "../VeyraSettlement.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Shared base for all VeyraSettlement test suites.
///      Deploys a MockERC20 (not the canonical Arc address) and two settlement
///      instances — one with feeBps=100 (1%) and one with feeBps=0.
abstract contract VeyraSettlementTestBase is Test {
    // ── actors ──────────────────────────────────────────────────────────────
    address internal owner     = makeAddr("owner");
    address internal payer     = makeAddr("payer");
    address internal recipient = makeAddr("recipient");
    address internal stranger  = makeAddr("stranger");

    // ── token ────────────────────────────────────────────────────────────────
    MockERC20 internal usdc;

    // ── contracts under test ────────────────────────────────────────────────
    VeyraSettlement internal settlement;   // feeBps = 100 (1%)
    VeyraSettlement internal settlementZ;  // feeBps = 0 (zero-fee)

    // ── constants ────────────────────────────────────────────────────────────
    uint256 internal constant AMOUNT    = 1_000e6;  // 1 000 USDC (6-decimal)
    uint256 internal constant FEE_BPS   = 100;      // 1%
    uint256 internal constant TIMEOUT   = 2 hours;

    // ── setUp ────────────────────────────────────────────────────────────────
    function setUp() public virtual {
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);

        vm.startPrank(owner);
        settlement  = new VeyraSettlement(address(usdc), owner, owner, uint16(FEE_BPS));
        settlementZ = new VeyraSettlement(address(usdc), owner, address(0), 0);
        vm.stopPrank();

        // Seed payer with tokens and approve both settlements
        usdc.mint(payer, 100_000e6);
        vm.startPrank(payer);
        usdc.approve(address(settlement),  type(uint256).max);
        usdc.approve(address(settlementZ), type(uint256).max);
        vm.stopPrank();
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// @dev Create an escrow via `settlement` and return its paymentId.
    function _createEscrow(uint256 amount, uint256 timeout)
        internal
        returns (bytes32 paymentId)
    {
        vm.prank(payer);
        paymentId = settlement.createEscrow(recipient, amount, timeout, bytes32(0));
    }

    /// @dev Create an escrow via `settlementZ` (zero fee) and return its paymentId.
    function _createEscrowZ(uint256 amount, uint256 timeout)
        internal
        returns (bytes32 paymentId)
    {
        vm.prank(payer);
        paymentId = settlementZ.createEscrow(recipient, amount, timeout, bytes32(0));
    }

    /// @dev Compute expected fee and net amounts for the 1% settlement.
    function _feeAndNet(uint256 amount) internal pure returns (uint256 fee, uint256 net) {
        fee = (amount * FEE_BPS) / 10_000;
        net = amount - fee;
    }
}
