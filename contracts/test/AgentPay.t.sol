// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../AgentPay.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ---- Minimal mock 6-decimal USDC --------------------------------------------

contract MockUSDC {
    string public constant name     = "USD Coin";
    string public constant symbol   = "USDC";
    uint8  public constant decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256)                     public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

// ---- Test helpers ------------------------------------------------------------

contract AgentPayTest is Test {
    AgentPay internal agentPay;
    MockUSDC  internal usdc;

    address internal alice = address(0xA11CE);
    address internal bob   = address(0xB0B);
    address internal carol = address(0xCA401);

    uint256 internal constant PRICE = 5_000; // 0.005 USDC (6-decimal)
    uint256 internal constant DAY   = 86_400;

    function setUp() public {
        usdc     = new MockUSDC();
        agentPay = new AgentPay(address(usdc));

        // Fund alice and carol with USDC; register bob as payee agent
        usdc.mint(alice, 1_000_000);  // 1 USDC
        usdc.mint(carol, 1_000_000);  // 1 USDC

        // Bob registers as an agent
        vm.prank(bob);
        agentPay.registerAgent("BobAgent", "https://bob.example.com", PRICE);
    }

    // ---- Helpers ---------------------------------------------------------------

    function _approveAndSetLimit(address payer, uint256 approvalAmt, uint256 limitPerDay) internal {
        vm.prank(payer);
        usdc.approve(address(agentPay), approvalAmt);
        vm.prank(payer);
        agentPay.setSpendingLimit(limitPerDay);
    }

    function _pay(address payer, address payee, bytes32 callId, uint256 maxAmount) internal {
        vm.prank(payer);
        agentPay.pay(payee, callId, maxAmount);
    }

    // ---- 1. pay transfers exactly pricePerCall ---------------------------------

    function test_pay_transfersExactPrice() public {
        _approveAndSetLimit(alice, PRICE, 100_000);
        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore   = usdc.balanceOf(bob);

        _pay(alice, bob, bytes32("call-1"), PRICE);

        assertEq(usdc.balanceOf(alice), aliceBefore - PRICE);
        assertEq(usdc.balanceOf(bob),   bobBefore   + PRICE);
        // Contract must hold no USDC after payment
        assertEq(usdc.balanceOf(address(agentPay)), 0);
    }

    // ---- 2. pay reverts when payee raised price above maxAmount ----------------

    function test_pay_reverts_priceMoved() public {
        _approveAndSetLimit(alice, 100_000, 100_000);

        // Bob raises price after alice quoted PRICE
        vm.prank(bob);
        agentPay.updateAgent("BobAgent", "https://bob.example.com", PRICE * 2);

        vm.expectRevert("Price moved");
        _pay(alice, bob, bytes32("call-x"), PRICE); // maxAmount = old price
    }

    // ---- 3. same callId from same payer reverts second time --------------------

    function test_pay_reverts_duplicateCallId_samePayer() public {
        _approveAndSetLimit(alice, PRICE * 2, 100_000);

        _pay(alice, bob, bytes32("dup-call"), PRICE);

        vm.expectRevert("callId already used");
        _pay(alice, bob, bytes32("dup-call"), PRICE);
    }

    // ---- 4. same callId from two different payers both succeed -----------------

    function test_pay_sameCallId_differentPayers_bothSucceed() public {
        _approveAndSetLimit(alice, PRICE, 100_000);
        _approveAndSetLimit(carol, PRICE, 100_000);

        bytes32 sharedCallId = bytes32("shared-call");
        _pay(alice, bob, sharedCallId, PRICE);  // alice uses it
        _pay(carol, bob, sharedCallId, PRICE);  // carol uses same callId — should succeed
    }

    // ---- 5. pay reverts when no spending limit is configured -------------------

    function test_pay_reverts_noSpendingLimit() public {
        vm.prank(alice);
        usdc.approve(address(agentPay), PRICE);
        // No setSpendingLimit call

        vm.expectRevert("Set a spending limit first");
        _pay(alice, bob, bytes32("call-nolimit"), PRICE);
    }

    // ---- 6a. daily limit blocks spend that would exceed it --------------------

    function test_spendingLimit_blocksOverLimit() public {
        // Limit = 8000 units; one payment = 5000 units; second would push to 10000
        _approveAndSetLimit(alice, PRICE * 3, 8_000);

        _pay(alice, bob, bytes32("call-a"), PRICE); // 5000 spent, 3000 left

        vm.expectRevert("Daily limit exceeded");
        _pay(alice, bob, bytes32("call-b"), PRICE); // 5000 more would exceed 8000 cap
    }

    // ---- 6b. spend after 24h window reset succeeds ----------------------------

    function test_spendingLimit_resetsAfter24h() public {
        _approveAndSetLimit(alice, PRICE * 2, PRICE); // exact limit = one payment

        _pay(alice, bob, bytes32("call-t1"), PRICE);  // uses full limit

        // Advance 24h + 1s — window resets
        vm.warp(block.timestamp + DAY + 1);

        // Now alice must re-approve (her allowance was spent)
        vm.prank(alice);
        usdc.approve(address(agentPay), PRICE);

        _pay(alice, bob, bytes32("call-t2"), PRICE);  // should succeed after reset
    }

    // ---- 7. paying unregistered agent reverts ---------------------------------

    function test_pay_reverts_unregisteredAgent() public {
        _approveAndSetLimit(alice, PRICE, 100_000);

        vm.expectRevert("Target not active");
        _pay(alice, carol, bytes32("bad-call"), PRICE); // carol is not registered
    }

    // ---- 8. paying inactive agent reverts -------------------------------------

    function test_pay_reverts_inactiveAgent() public {
        vm.prank(bob);
        agentPay.setActive(false);

        _approveAndSetLimit(alice, PRICE, 100_000);

        vm.expectRevert("Target not active");
        _pay(alice, bob, bytes32("inactive-call"), PRICE);
    }

    // ---- 9. paying yourself reverts -------------------------------------------

    function test_pay_reverts_selfPay() public {
        // Bob tries to pay himself (to inflate totalCallsPaid)
        vm.prank(bob);
        agentPay.setSpendingLimit(100_000);
        usdc.mint(bob, PRICE);
        vm.prank(bob);
        usdc.approve(address(agentPay), PRICE);

        vm.expectRevert("Cannot pay yourself");
        vm.prank(bob);
        agentPay.pay(bob, bytes32("self-call"), PRICE);
    }

    // ---- 10. contract holds no USDC after payment (redundant but explicit) ----

    function test_contractHoldsNoUsdc() public {
        _approveAndSetLimit(alice, PRICE, 100_000);
        _pay(alice, bob, bytes32("hold-check"), PRICE);
        assertEq(usdc.balanceOf(address(agentPay)), 0);
    }

    // ---- 11. setSpendingLimit requires perDay > 0 ------------------------------

    function test_setSpendingLimit_reverts_zero() public {
        vm.expectRevert("Limit must be positive");
        vm.prank(alice);
        agentPay.setSpendingLimit(0);
    }

    // ---- 12. constructor rejects zero address and non-contract -----------------

    function test_constructor_reverts_zeroAddress() public {
        vm.expectRevert("USDC: zero address");
        new AgentPay(address(0));
    }

    function test_constructor_reverts_notContract() public {
        vm.expectRevert("USDC: not a contract");
        new AgentPay(alice); // alice is an EOA
    }

    // ---- 13. listActiveAgents pagination works ---------------------------------

    function test_listActiveAgents_pagination() public {
        // Register two more agents beyond bob
        vm.prank(carol);
        agentPay.registerAgent("CarolAgent", "https://carol.example.com", PRICE);

        address dave = address(0xDA4E);
        vm.prank(dave);
        agentPay.registerAgent("DaveAgent", "https://dave.example.com", PRICE);

        // Page 0, limit 2 → bob + carol
        (address[] memory addrs, , uint256 total) = agentPay.listActiveAgents(0, 2);
        assertEq(total, 3);
        assertEq(addrs.length, 2);
        assertEq(addrs[0], bob);
        assertEq(addrs[1], carol);

        // Page 1 (offset=2), limit 2 → dave only
        (address[] memory addrs2, , ) = agentPay.listActiveAgents(2, 2);
        assertEq(addrs2.length, 1);
        assertEq(addrs2[0], dave);
    }

    // ---- 14. PaymentMade event emitted with correct values --------------------

    function test_pay_emitsEvent() public {
        _approveAndSetLimit(alice, PRICE, 100_000);

        bytes32 callId = bytes32("event-call");
        vm.expectEmit(true, true, true, true, address(agentPay));
        emit AgentPay.PaymentMade(alice, bob, PRICE, callId, block.timestamp);

        _pay(alice, bob, callId, PRICE);
    }
}
