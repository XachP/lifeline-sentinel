// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DecisionLog} from "../src/DecisionLog.sol";

/// The exact report bytes produced by the TypeScript judge (cre/sentinel) for a live Mezo snapshot
/// must be accepted and decoded field-for-field by DecisionLog.
contract CrossLanguageTest is Test {
    function test_acceptsReportProducedByTypeScriptJudge() public {
        string memory j = vm.readFile("../cre/sentinel/test/fixtures/live-2026-10-21.json");
        bytes memory report = vm.parseJsonBytes(j, ".report");
        bytes32 policyHash = vm.parseJsonBytes32(j, ".decision.policyHash");
        bytes32 evidenceHash = vm.parseJsonBytes32(j, ".decision.evidenceHash");
        bytes32 reasoningHash = vm.parseJsonBytes32(j, ".decision.reasoningHash");
        address fwd = address(0xF0);
        DecisionLog dlog = new DecisionLog(fwd);
        dlog.registerPolicy(policyHash, "https://xachp.github.io/lifeline-sentinel/policy/v1.json");
        vm.prank(fwd);
        dlog.onReport("", report);
        DecisionLog.Decision memory d = dlog.getDecision(0);
        assertEq(d.vault, 0xC92BfDC83b03d32e39930Bfb789233e1Cc0fdbEF);
        assertEq(uint8(d.action), 0); // HOLD
        assertEq(uint8(d.practice), 1); // REDEMPTION_ARB
        assertEq(d.icrBps, 14754);
        assertEq(d.mezoBlock, 16291108);
        assertEq(d.evidenceHash, evidenceHash);
        assertEq(d.policyHash, policyHash);
        assertEq(d.reasoningHash, reasoningHash);
        assertEq(d.practiceSize, 2000e18);
    }

    function test_policyHashMatchesRegisteredOnMezo() public view {
        string memory j = vm.readFile("../cre/sentinel/test/fixtures/live-2026-10-21.json");
        assertEq(vm.parseJsonBytes32(j, ".decision.policyHash"), 0x57065b3444adb76b5fbdc26e209f2d89ec531bdce8a189657e6ddfc527304b89);
    }
}
