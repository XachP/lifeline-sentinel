// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal read interfaces for mUSD on Mezo (github.com/mezo-org/musd) and the Lifeline vault.
interface ITroveManager {
    function getCurrentICR(address borrower, uint256 price) external view returns (uint256);
    function getEntireDebtAndColl(address borrower)
        external
        view
        returns (uint256 coll, uint256 principal, uint256 interest, uint256 pc, uint256 pp, uint256 pi);
    function getTroveStatus(address borrower) external view returns (uint8);
    function checkRecoveryMode(uint256 price) external view returns (bool);
    function getTCR(uint256 price) external view returns (uint256);
}

interface ISortedTroves {
    function getLast() external view returns (address);
    function getPrev(address id) external view returns (address);
    function getSize() external view returns (uint256);
}

interface IPriceFeed {
    function fetchPrice() external view returns (uint256);
}

interface ILifelineVault {
    struct Health {
        uint8 status;
        uint256 price;
        uint256 icr;
        uint256 trigger;
        uint256 target;
        bool recoveryMode;
        bool needsProtection;
        uint256 coll;
        uint256 debt;
        uint256 reserveBtc;
        uint256 reserveMusd;
        uint256 liquidationPrice;
        uint256 redemptionSafeICR;
        bool redemptionRisk;
    }

    function health() external view returns (Health memory);
    function owner() external view returns (address);
}

interface ILifelineFactory {
    function vaultCount() external view returns (uint256);
}
