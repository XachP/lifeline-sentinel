// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {SentinelLens} from "../src/SentinelLens.sol";
import {ITroveManager, ISortedTroves, IPriceFeed, ILifelineFactory} from "../src/IMezo.sol";

/// Only PriceFeed.fetchPrice() is mocked (with the live value). Fork test against the LIVE Mezo testnet (matsnet). Run: forge test --match-contract Fork --fork-url mezo_testnet
contract SentinelLensForkTest is Test {
    address constant TM = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant ST = 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA;
    address constant PF = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant FACTORY = 0x37aC7acd4e48b79bb0dc6AaCA5AF3611cF176149;
    address constant VAULT = 0xC92BfDC83b03d32e39930Bfb789233e1Cc0fdbEF;
    SentinelLens lens;

    function setUp() public {
        if (block.chainid != 31611) {
            vm.skip(true);
            return;
        }
        // Mezo's oracle is a chain precompile a local fork cannot execute: pin the LIVE price via vm.rpc.
        bytes memory raw = vm.rpc(
            "eth_call",
            string.concat('[{"to":"', vm.toString(PF), '","data":"0x0fdb11cf"},"latest"]')
        );
        vm.mockCall(PF, abi.encodeWithSelector(IPriceFeed.fetchPrice.selector), raw);
        lens = new SentinelLens(ITroveManager(TM), ISortedTroves(ST), IPriceFeed(PF), ILifelineFactory(FACTORY));
    }

    function test_snapshotOfLiveVault() public view {
        SentinelLens.Snapshot memory s = lens.snapshot(VAULT, 400, 5);
        console2.log("queue size", s.queueSize);
        console2.log("rank from front", s.rankFromFront);
        console2.log("debt ahead (MUSD)", s.debtAhead / 1e18);
        console2.log("vault ICR bps", s.health.icr / 1e14);
        assertEq(s.health.status, 1, "vault trove active");
        assertTrue(s.walkComplete, "vault found in queue");
        assertGt(s.rankFromFront, 0);
        assertEq(s.front.length, 5);
        // front of the queue is sorted by ascending ICR (lowest = redeemed first)
        for (uint256 i = 1; i < s.front.length; i++) {
            assertGe(s.front[i].icr, s.front[i - 1].icr, "queue order");
        }
        assertGt(s.lifelineVaults, 0);
        assertGt(s.tcr, 0);
    }

    function test_debtAheadMatchesManualWalk() public view {
        SentinelLens.Snapshot memory s = lens.snapshot(VAULT, 400, 3);
        uint256 manual;
        address cur = ISortedTroves(ST).getLast();
        while (cur != VAULT) {
            (, uint256 p, uint256 i,,,) = ITroveManager(TM).getEntireDebtAndColl(cur);
            manual += p + i;
            cur = ISortedTroves(ST).getPrev(cur);
        }
        assertEq(s.debtAhead, manual);
    }

    function test_boundedWalkReportsIncomplete() public view {
        SentinelLens.Snapshot memory s = lens.snapshot(VAULT, 1, 1);
        if (s.rankFromFront != 1) assertFalse(s.walkComplete);
    }
}
