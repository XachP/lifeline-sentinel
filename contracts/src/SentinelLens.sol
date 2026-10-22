// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITroveManager, ISortedTroves, IPriceFeed, ILifelineVault, ILifelineFactory} from "./IMezo.sol";

/// @title SentinelLens
/// @notice Read-only, one-call evidence snapshot of a Lifeline vault and the mUSD redemption queue.
/// @dev Built so an oracle network (Chainlink CRE nodes) can fetch everything with ONE eth_call and
///      reach identical consensus at a pinned block. Mezo is not yet in CRE's chain registry, so CRE
///      nodes call this through the HTTP capability (JSON-RPC eth_call) instead of the EVM capability.
///      Redemptions in mUSD (Liquity-style) start from the LOWEST-ICR trove, i.e. SortedTroves.getLast().
contract SentinelLens {
    struct QueueEntry {
        address borrower;
        uint256 icr; // 1e18 = 100%
        uint256 debt; // principal + interest, MUSD wei
    }

    struct Snapshot {
        uint256 blockNumber;
        uint256 timestamp;
        address vault;
        address vaultOwner;
        ILifelineVault.Health health;
        uint256 tcr; // total collateral ratio of the system
        uint256 queueSize; // active troves
        uint256 rankFromFront; // 1 = the next trove a redemption would hit; 0 = not found within walk
        uint256 debtAhead; // MUSD that must be redeemed before the vault's trove is touched
        bool walkComplete; // false if maxWalk was hit before finding the vault
        uint256 lifelineVaults; // vaults created by the factory (ecosystem context)
        QueueEntry[] front; // the first `frontN` troves at the front of the redemption queue
    }

    ITroveManager public immutable troveManager;
    ISortedTroves public immutable sortedTroves;
    IPriceFeed public immutable priceFeed;
    ILifelineFactory public immutable factory;

    constructor(ITroveManager tm, ISortedTroves st, IPriceFeed pf, ILifelineFactory f) {
        troveManager = tm;
        sortedTroves = st;
        priceFeed = pf;
        factory = f;
    }

    /// @param vault Lifeline vault (its own address is the trove owner)
    /// @param maxWalk max troves to walk from the front of the queue (bounds gas)
    /// @param frontN how many front-of-queue troves to return verbatim
    function snapshot(address vault, uint256 maxWalk, uint256 frontN) external view returns (Snapshot memory s) {
        s.blockNumber = block.number;
        s.timestamp = block.timestamp;
        s.vault = vault;
        s.vaultOwner = ILifelineVault(vault).owner();
        s.health = ILifelineVault(vault).health();
        uint256 price = s.health.price;
        s.tcr = troveManager.getTCR(price);
        s.queueSize = sortedTroves.getSize();
        try factory.vaultCount() returns (uint256 vc) {
            s.lifelineVaults = vc;
        } catch {}

        uint256 n = frontN < s.queueSize ? frontN : s.queueSize;
        s.front = new QueueEntry[](n);

        address cur = sortedTroves.getLast();
        uint256 i;
        while (cur != address(0) && i < maxWalk) {
            uint256 icr = troveManager.getCurrentICR(cur, price);
            uint256 debt = _debt(cur);
            if (i < n) s.front[i] = QueueEntry(cur, icr, debt);
            if (cur == vault) {
                s.rankFromFront = i + 1;
                s.walkComplete = true;
                if (i >= n) break;
            } else if (s.rankFromFront == 0) {
                s.debtAhead += debt;
            }
            if (s.rankFromFront != 0 && i + 1 >= n) break;
            cur = sortedTroves.getPrev(cur);
            unchecked {
                ++i;
            }
        }
    }

    function _debt(address borrower) internal view returns (uint256) {
        (, uint256 principal, uint256 interest,,,) = troveManager.getEntireDebtAndColl(borrower);
        return principal + interest;
    }
}
