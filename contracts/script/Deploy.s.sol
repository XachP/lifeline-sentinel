// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SentinelLens} from "../src/SentinelLens.sol";
import {DecisionLog} from "../src/DecisionLog.sol";
import {ITroveManager, ISortedTroves, IPriceFeed, ILifelineFactory} from "../src/IMezo.sol";

/// Deploys SentinelLens + DecisionLog on Mezo testnet and registers policy v1.
/// env: FORWARDER (CRE forwarder or the disclosed relayer), POLICY_HASH, POLICY_URI
contract Deploy is Script {
    address constant TROVE_MANAGER = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant SORTED_TROVES = 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA;
    address constant PRICE_FEED = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant LIFELINE_FACTORY = 0x37aC7acd4e48b79bb0dc6AaCA5AF3611cF176149;

    function run() external {
        address forwarder = vm.envAddress("FORWARDER");
        bytes32 policyHash = vm.envBytes32("POLICY_HASH");
        string memory policyUri = vm.envString("POLICY_URI");
        vm.startBroadcast();
        SentinelLens lens = new SentinelLens(
            ITroveManager(TROVE_MANAGER), ISortedTroves(SORTED_TROVES), IPriceFeed(PRICE_FEED), ILifelineFactory(LIFELINE_FACTORY)
        );
        DecisionLog dlog = new DecisionLog(forwarder);
        dlog.registerPolicy(policyHash, policyUri);
        vm.stopBroadcast();
        console2.log("SentinelLens:", address(lens));
        console2.log("DecisionLog:", address(dlog));
    }
}
