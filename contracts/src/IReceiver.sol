// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Chainlink CRE report receiver (same interface the KeystoneForwarder calls).
/// Source: https://docs.chain.link/cre (ReceiverTemplate / IReceiver).
interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
