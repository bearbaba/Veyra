// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VeyraSettlementV2} from "../VeyraSettlementV2.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

contract ReentryToken is IERC20 {
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;
    uint256 public override totalSupply;
    VeyraSettlementV2 public target;
    bool public reentryChecked;
    bool public reentryBlocked;
    uint256 public constant BALANCE = 10_000e6;
    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
        totalSupply += value;
        emit Transfer(address(0), to, value);
    }
    function configure(VeyraSettlementV2 settlement) external {target=settlement;}
    function approve(address spender,uint256 value) external override returns(bool) {
        allowance[msg.sender][spender]=value;
        emit Approval(msg.sender,spender,value);
        return true;
    }
    function transfer(address to,uint256 value) external override returns(bool) {
        require(balanceOf[msg.sender]>=value);
        balanceOf[msg.sender]-=value;balanceOf[to]+=value;emit Transfer(msg.sender,to,value);
        return true;
    }
    function transferFrom(address from,address to,uint256 value) external override returns(bool) {
        require(balanceOf[from]>=value&&allowance[from][msg.sender]>=value);
        if(!reentryChecked){
            reentryChecked=true;
            (bool ok,bytes memory returned)=address(target).call(abi.encodeWithSelector(
                VeyraSettlementV2.pay.selector,address(0xC0DE),1e6,bytes32(uint256(9))
            ));
            bytes4 selector;
            if(returned.length>=4){
                assembly {selector := mload(add(returned,32))}
            }
            reentryBlocked=!ok&&selector==bytes4(keccak256("ReentrancyGuardReentrantCall()"));
        }
        allowance[from][msg.sender]-=value;
        balanceOf[from]-=value;
        balanceOf[to]+=value;
        emit Transfer(from,to,value);
        return true;
    }
}

contract VeyraSettlementV2Test is Test {
    VeyraSettlementV2 internal settlement;
    MockERC20 internal usdc;
    address internal owner=makeAddr("owner");
    address internal alice=makeAddr("payerAlice");
    address internal bob=makeAddr("payerBob");
    uint256 internal issuerPk=0xB0B123;
    address internal recipient;
    uint256 internal constant AMOUNT=100e6;
    bytes32 internal constant REF=keccak256("VEYRA_PAYMENT_REQUEST_V1:prq_123456789ABCDEFGHJK");
    uint256 internal deadline;

    function setUp() public {
        recipient=vm.addr(issuerPk);
        usdc=new MockERC20("USDC","USDC",6);
        settlement=new VeyraSettlementV2(address(usdc),owner,owner,100);
        usdc.mint(alice,1000e6);
        usdc.mint(bob,1000e6);
        vm.prank(alice);usdc.approve(address(settlement),type(uint256).max);
        vm.prank(bob);usdc.approve(address(settlement),type(uint256).max);
        deadline=block.timestamp+1 days;
    }
    function sig(address payer,address receiving,uint256 amount,bytes32 ref,uint256 expiry)
        internal returns(bytes memory)
    {
        bytes32 digest=settlement.requestDigest(payer,receiving,amount,ref,expiry);
        (uint8 v,bytes32 r,bytes32 s)=vm.sign(issuerPk,digest);
        return abi.encodePacked(r,s,v);
    }
    function payRequestAs(address payer,bytes memory signature) internal {
        vm.prank(payer);
        settlement.payRequest(recipient,AMOUNT,REF,deadline,signature);
    }

    function test_PayPayerScopedRefAndRecipientNet() public {
        vm.prank(alice);settlement.pay(recipient,AMOUNT,REF);
        assertTrue(settlement.payerRefUsed(alice,REF));
        assertEq(usdc.balanceOf(recipient),AMOUNT-AMOUNT/100);
        vm.prank(alice);
        vm.expectRevert(VeyraSettlementV2.ReferenceAlreadyUsed.selector);
        settlement.pay(recipient,AMOUNT,REF);
        // A stranger cannot lock Alice's ref by paying their own money.
        vm.prank(bob);settlement.pay(recipient,AMOUNT,REF);
        assertTrue(settlement.payerRefUsed(bob,REF));
    }
    function test_RejectZeroRefAndPreserveBalance() public {
        uint256 prior=usdc.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(VeyraSettlementV2.InvalidReference.selector);
        settlement.pay(recipient,AMOUNT,bytes32(0));
        assertEq(usdc.balanceOf(alice),prior);
    }
    function test_SignedRequestConsumesGlobalAndPayerRef() public {
        bytes memory auth=sig(alice,recipient,AMOUNT,REF,deadline);
        payRequestAs(alice,auth);
        assertTrue(settlement.requestRefUsed(REF));
        assertTrue(settlement.payerRefUsed(alice,REF));
        assertEq(usdc.balanceOf(recipient),AMOUNT-AMOUNT/100);
        vm.prank(alice);
        vm.expectRevert(VeyraSettlementV2.ReferenceAlreadyUsed.selector);
        settlement.payRequest(recipient,AMOUNT,REF,deadline,auth);
        vm.prank(alice);
        vm.expectRevert(VeyraSettlementV2.ReferenceAlreadyUsed.selector);
        settlement.pay(recipient,AMOUNT,REF);
    }
    function test_WrongPayerCannotSquatGlobalRef() public {
        bytes memory auth=sig(alice,recipient,AMOUNT,REF,deadline);
        vm.prank(bob);
        vm.expectRevert(VeyraSettlementV2.InvalidRecipientAuthorization.selector);
        settlement.payRequest(recipient,AMOUNT,REF,deadline,auth);
        assertFalse(settlement.requestRefUsed(REF));
        assertFalse(settlement.payerRefUsed(bob,REF));
        payRequestAs(alice,auth);
        assertTrue(settlement.requestRefUsed(REF));
    }
    function test_PayerScopedGenericPayCannotConsumeAnotherPayerRequest() public {
        bytes memory auth=sig(alice,recipient,AMOUNT,REF,deadline);
        vm.prank(bob);settlement.pay(recipient,AMOUNT,REF);
        assertFalse(settlement.requestRefUsed(REF));
        payRequestAs(alice,auth);
        assertTrue(settlement.requestRefUsed(REF));
    }
    function test_RequestCannotBeReusedBySecondAuthorizedPayer() public {
        bytes memory aliceAuth=sig(alice,recipient,AMOUNT,REF,deadline);
        bytes memory bobAuth=sig(bob,recipient,AMOUNT,REF,deadline);
        payRequestAs(alice,aliceAuth);
        vm.prank(bob);
        vm.expectRevert(VeyraSettlementV2.ReferenceAlreadyUsed.selector);
        settlement.payRequest(recipient,AMOUNT,REF,deadline,bobAuth);
    }
    function test_InvalidSignatureAmountRecipientAndDeadline() public {
        bytes memory auth=sig(alice,recipient,AMOUNT,REF,deadline);
        vm.prank(alice);
        vm.expectRevert(VeyraSettlementV2.InvalidRecipientAuthorization.selector);
        settlement.payRequest(recipient,AMOUNT+1,REF,deadline,auth);
        vm.prank(alice);
        vm.expectRevert(VeyraSettlementV2.InvalidRecipientAuthorization.selector);
        settlement.payRequest(makeAddr("differentRecipient"),AMOUNT,REF,deadline,auth);
        vm.warp(deadline+1);
        vm.prank(alice);
        vm.expectRevert(VeyraSettlementV2.AuthorizationExpired.selector);
        settlement.payRequest(recipient,AMOUNT,REF,deadline,auth);
        assertFalse(settlement.requestRefUsed(REF));
    }
    function test_RevertedTransferDoesNotConsumeRef() public {
        bytes32 newRef=keccak256("retryAfterTokenRevert");
        vm.prank(alice);usdc.approve(address(settlement),0);
        vm.prank(alice);vm.expectRevert();
        settlement.pay(recipient,AMOUNT,newRef);
        assertFalse(settlement.payerRefUsed(alice,newRef));
        vm.prank(alice);usdc.approve(address(settlement),AMOUNT);
        vm.prank(alice);settlement.pay(recipient,AMOUNT,newRef);
        assertTrue(settlement.payerRefUsed(alice,newRef));
    }
    function test_RevertedRequestTransferDoesNotConsumeGlobalRef() public {
        bytes memory auth=sig(alice,recipient,AMOUNT,REF,deadline);
        vm.prank(alice);usdc.approve(address(settlement),0);
        vm.prank(alice);vm.expectRevert();
        settlement.payRequest(recipient,AMOUNT,REF,deadline,auth);
        assertFalse(settlement.requestRefUsed(REF));
        vm.prank(alice);usdc.approve(address(settlement),AMOUNT);
        payRequestAs(alice,auth);
        assertTrue(settlement.requestRefUsed(REF));
    }
    function test_TokenReentryBlocked() public {
        ReentryToken token=new ReentryToken();
        VeyraSettlementV2 instance=new VeyraSettlementV2(address(token),owner,owner,0);
        token.configure(instance);
        token.mint(alice,AMOUNT);
        vm.prank(alice);token.approve(address(instance),AMOUNT);
        vm.prank(alice);instance.pay(recipient,AMOUNT,keccak256("reentry"));
        assertTrue(token.reentryChecked());
        assertTrue(token.reentryBlocked());
        assertEq(token.balanceOf(recipient),AMOUNT);
    }
    function test_RequestSignatureDomainCannotReplayOnOtherContract() public {
        VeyraSettlementV2 second=new VeyraSettlementV2(address(usdc),owner,owner,0);
        bytes memory originalAuthorization=sig(alice,recipient,AMOUNT,REF,deadline);
        vm.prank(alice);
        vm.expectRevert(VeyraSettlementV2.InvalidRecipientAuthorization.selector);
        second.payRequest(recipient,AMOUNT,REF,deadline,originalAuthorization);
    }
}
