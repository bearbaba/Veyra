// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {VeyraSettlement} from "../VeyraSettlement.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Handler — the ONLY surface the invariant fuzzer drives.
// Tracks ghost accounting so the invariant can compare against expected state.
// ─────────────────────────────────────────────────────────────────────────────
contract VeyraSettlementHandler is Test {
    VeyraSettlement public settlement;
    MockERC20       public usdc;

    address internal payer     = makeAddr("inv_payer");
    address internal recipient = makeAddr("inv_recipient");

    // Ghost: sum of all ACTIVE escrow amounts still held by the contract.
    uint256 public ghostActiveEscrow;
    // Ghost: total accrued fees (cross-checks settlement.accruedFees()).
    uint256 public ghostAccruedFees;

    // Track created escrow IDs so we can release/refund them.
    bytes32[] internal _activeIds;
    // Map id → amount so we can subtract on release/refund.
    mapping(bytes32 => uint256) internal _escrowAmount;

    constructor(VeyraSettlement _settlement, MockERC20 _usdc) {
        settlement = _settlement;
        usdc       = _usdc;

        // Seed payer with a large supply and give max approval.
        usdc.mint(payer, 1_000_000e6);
        vm.prank(payer);
        usdc.approve(address(settlement), type(uint256).max);
    }

    // ── actions ──────────────────────────────────────────────────────────────

    function createEscrow(uint256 amount, uint256 timeout) external {
        amount  = bound(amount,  1, 10_000e6);
        timeout = bound(timeout, 1 hours, 30 days);

        // Ensure payer has enough balance.
        if (usdc.balanceOf(payer) < amount) {
            usdc.mint(payer, amount);
        }

        vm.prank(payer);
        bytes32 id = settlement.createEscrow(recipient, amount, timeout, bytes32(0));

        _activeIds.push(id);
        _escrowAmount[id] = amount;
        ghostActiveEscrow += amount;
    }

    function releaseEscrow(uint256 index) external {
        if (_activeIds.length == 0) return;
        index = bound(index, 0, _activeIds.length - 1);
        bytes32 id = _activeIds[index];

        VeyraSettlement.Escrow memory e = settlement.getEscrow(id);
        if (e.state != VeyraSettlement.EscrowState.ACTIVE) return;
        if (block.timestamp >= e.expiresAt) return; // would revert

        uint256 amount = _escrowAmount[id];
        uint256 fee    = (amount * settlement.feeBps()) / 10_000;

        vm.prank(recipient);
        settlement.releaseEscrow(id);

        ghostActiveEscrow -= amount;
        ghostAccruedFees  += fee;
        _removeId(index);
    }

    function refundEscrow(uint256 index) external {
        if (_activeIds.length == 0) return;
        index = bound(index, 0, _activeIds.length - 1);
        bytes32 id = _activeIds[index];

        VeyraSettlement.Escrow memory e = settlement.getEscrow(id);
        if (e.state != VeyraSettlement.EscrowState.ACTIVE) return;
        if (block.timestamp < e.expiresAt) {
            // Advance time so refund is allowed.
            vm.warp(e.expiresAt + 1);
        }

        uint256 amount = _escrowAmount[id];

        vm.prank(payer);
        settlement.refundEscrow(id);

        ghostActiveEscrow -= amount;
        _removeId(index);
    }

    function directPay(uint256 amount) external {
        amount = bound(amount, 1, 10_000e6);
        if (usdc.balanceOf(payer) < amount) {
            usdc.mint(payer, amount);
        }

        uint256 fee = (amount * settlement.feeBps()) / 10_000;

        vm.prank(payer);
        settlement.pay(recipient, amount, bytes32(0));

        ghostAccruedFees += fee;
    }

    // ── internal ─────────────────────────────────────────────────────────────

    function _removeId(uint256 index) internal {
        _activeIds[index] = _activeIds[_activeIds.length - 1];
        _activeIds.pop();
    }

    function activeCount() external view returns (uint256) {
        return _activeIds.length;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant test contract
// ─────────────────────────────────────────────────────────────────────────────
contract VeyraSettlementInvariantTest is Test {
    VeyraSettlement         internal settlement;
    MockERC20               internal usdc;
    VeyraSettlementHandler  internal handler;

    address internal owner = makeAddr("inv_owner");

    function setUp() public {
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);

        vm.prank(owner);
        settlement = new VeyraSettlement(address(usdc), owner, owner, 100);

        handler = new VeyraSettlementHandler(settlement, usdc);

        // Restrict the fuzzer to only call through the handler.
        targetContract(address(handler));
    }

    // ── invariants ───────────────────────────────────────────────────────────

    /// @dev PROPERTY: The contract's USDC balance is always >= the sum of all
    ///      active escrow amounts (plus accrued fees).
    ///      Equivalently: contract balance >= ghostActiveEscrow + accruedFees.
    function invariant_ContractBalanceCoversEscrowAndFees() public view {
        uint256 contractBalance = usdc.balanceOf(address(settlement));
        uint256 needed          = handler.ghostActiveEscrow() + settlement.accruedFees();
        assertGe(
            contractBalance,
            needed,
            "contract balance < active escrow + accrued fees"
        );
    }

    /// @dev PROPERTY: accruedFees tracked by ghost equals the contract state.
    function invariant_GhostFeesMatchContractFees() public view {
        assertEq(
            settlement.accruedFees(),
            handler.ghostAccruedFees(),
            "ghost fees != contract accruedFees"
        );
    }

    /// @dev PROPERTY: Active escrow amounts never exceed the contract's total
    ///      token balance (a conservative bound that never requires knowing the
    ///      released/refunded split).
    function invariant_ActiveEscrowLeqContractBalance() public view {
        assertLe(
            handler.ghostActiveEscrow(),
            usdc.balanceOf(address(settlement)),
            "active escrow > contract balance"
        );
    }
}
