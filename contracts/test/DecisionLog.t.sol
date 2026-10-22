// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DecisionLog} from "../src/DecisionLog.sol";
import {IReceiver, IERC165} from "../src/IReceiver.sol";

contract DecisionLogTest is Test {
    DecisionLog dlog;
    address fwd = address(0xF0);
    address vault = address(0xC92B);
    bytes32 policy = keccak256("lifeline-sentinel/policy/v1");

    event DecisionLogged(
        uint256 indexed id,
        address indexed vault,
        DecisionLog.Action action,
        DecisionLog.PracticeKind practice,
        uint16 confidenceBps,
        uint32 icrBps,
        bytes32 evidenceHash,
        bytes32 policyHash,
        bytes32 reasoningHash
    );

    function setUp() public {
        dlog = new DecisionLog(fwd);
        dlog.registerPolicy(policy, "ipfs://policy-v1");
    }

    function _report(uint64 t, bytes32 ev, bytes32 pol, uint8 action) internal view returns (bytes memory) {
        return abi.encode(
            t, uint64(123), vault, action, uint8(1), uint16(6200), uint32(14758), int32(410), int32(-120),
            uint128(250e18), ev, pol, keccak256("reasoning")
        );
    }

    function test_logsDecisionFromForwarder() public {
        bytes32 ev = keccak256("evidence-1");
        vm.expectEmit(true, true, false, true);
        emit DecisionLogged(0, vault, DecisionLog.Action.WATCH, DecisionLog.PracticeKind.REDEMPTION_ARB, 6200, 14758, ev, policy, keccak256("reasoning"));
        vm.prank(fwd);
        dlog.onReport("", _report(1000, ev, policy, 1));
        assertEq(dlog.decisionsCount(), 1);
        DecisionLog.Decision memory d = dlog.getDecision(0);
        assertEq(d.vault, vault);
        assertEq(uint8(d.action), 1);
        assertEq(d.practiceSize, 250e18);
        assertEq(d.bullScore, 410);
        assertEq(d.bearScore, -120);
        assertEq(d.mezoBlock, 123);
        assertEq(d.evidenceHash, ev);
        assertEq(d.loggedAt, block.timestamp);
        assertEq(dlog.lastObservedAt(vault), 1000);
    }

    function test_rejectsNonForwarder() public {
        vm.expectRevert(abi.encodeWithSelector(DecisionLog.NotForwarder.selector, address(this)));
        dlog.onReport("", _report(1000, keccak256("e"), policy, 0));
    }

    function test_rejectsUnregisteredPolicy() public {
        bytes32 rogue = keccak256("rules I made up");
        vm.prank(fwd);
        vm.expectRevert(abi.encodeWithSelector(DecisionLog.UnknownPolicy.selector, rogue));
        dlog.onReport("", _report(1000, keccak256("e"), rogue, 0));
    }

    function test_rejectsRetiredPolicy() public {
        dlog.retirePolicy(policy);
        vm.prank(fwd);
        vm.expectRevert(abi.encodeWithSelector(DecisionLog.UnknownPolicy.selector, policy));
        dlog.onReport("", _report(1000, keccak256("e"), policy, 0));
    }

    function test_rejectsStaleOrReplayedObservation() public {
        vm.startPrank(fwd);
        dlog.onReport("", _report(1000, keccak256("e1"), policy, 0));
        vm.expectRevert(abi.encodeWithSelector(DecisionLog.StaleObservation.selector, uint64(1000), uint64(1000)));
        dlog.onReport("", _report(1000, keccak256("e2"), policy, 0));
        vm.expectRevert(abi.encodeWithSelector(DecisionLog.EvidenceReplay.selector, keccak256("e1")));
        dlog.onReport("", _report(1001, keccak256("e1"), policy, 0));
        vm.stopPrank();
    }

    function test_rejectsMalformedReport() public {
        vm.startPrank(fwd);
        vm.expectRevert(DecisionLog.BadReport.selector);
        dlog.onReport("", hex"deadbeef");
        bytes memory r = abi.encode(
            uint64(5), uint64(1), vault, uint8(0), uint8(0), uint16(10_001), uint32(1), int32(0), int32(0),
            uint128(0), keccak256("x"), policy, bytes32(0)
        );
        vm.expectRevert(DecisionLog.BadReport.selector);
        dlog.onReport("", r);
        vm.stopPrank();
    }

    function test_rejectsOutOfRangeEnum() public {
        bytes memory r = _report(1000, keccak256("e"), policy, 9);
        vm.prank(fwd);
        vm.expectRevert();
        dlog.onReport("", r);
    }

    function test_disputeTrail() public {
        vm.prank(fwd);
        dlog.onReport("", _report(1000, keccak256("e"), policy, 2));
        address owner_ = address(0xBEEF);
        vm.prank(owner_);
        dlog.dispute(0, keccak256("replay mismatch"), "replayed evidence gives HOLD, not PROTECT");
        assertEq(dlog.disputeCount(0), 1);
        vm.expectRevert(abi.encodeWithSelector(DecisionLog.NoSuchDecision.selector, 7));
        dlog.dispute(7, bytes32(0), "");
    }

    function test_adminIsOwnerOnly() public {
        vm.startPrank(address(0xBAD));
        vm.expectRevert(DecisionLog.NotOwner.selector);
        dlog.registerPolicy(keccak256("p2"), "");
        vm.expectRevert(DecisionLog.NotOwner.selector);
        dlog.setForwarder(address(0xBAD));
        vm.stopPrank();
        dlog.setForwarder(address(0xF1));
        assertEq(dlog.forwarder(), address(0xF1));
    }

    function test_supportsReceiverInterface() public view {
        assertTrue(dlog.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(dlog.supportsInterface(type(IERC165).interfaceId));
        assertFalse(dlog.supportsInterface(0xffffffff));
    }

    function testFuzz_monotonicPerVault(uint64 a, uint64 b) public {
        vm.assume(a > 0);
        vm.startPrank(fwd);
        dlog.onReport("", _report(a, keccak256(abi.encode(a)), policy, 0));
        if (b <= a) {
            vm.expectRevert(abi.encodeWithSelector(DecisionLog.StaleObservation.selector, b, a));
        }
        dlog.onReport("", _report(b, keccak256(abi.encode(a, b)), policy, 0));
        vm.stopPrank();
    }
}
