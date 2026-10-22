// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IReceiver, IERC165} from "./IReceiver.sol";

/// @title DecisionLog: a duty-of-care record for automated collateral management
/// @notice Every decision an automated agent takes (or declines to take) about a Lifeline vault is
///         written here as a Chainlink CRE report. Each entry commits to:
///           - evidenceHash : keccak256 of the canonical JSON of everything the agent saw
///           - policyHash   : keccak256 of the canonical JSON of the rules it was bound by (must be registered)
///           - reasoningHash: keccak256 of the bull case, bear case and judge trail
///         Anyone holding the published evidence + policy can re-run the deterministic judge and must get
///         the same action and the same hashes. Vault owners (or anyone) can open a dispute on an entry.
/// @dev Implements the CRE IReceiver interface. `forwarder` is the Chainlink KeystoneForwarder on chains
///      CRE supports. Mezo is not yet in CRE's chain registry, so on Mezo testnet the forwarder slot holds a
///      disclosed relayer that posts the exact report bytes the workflow produced (see README, "Trust model").
contract DecisionLog is IReceiver {
    enum Action {
        HOLD, // 0 nothing to do
        WATCH, // 1 risk rising: raise monitoring cadence
        PROTECT, // 2 call vault.protect() (any keeper may; only moves the owner's reserve into the owner's trove)
        ESCALATE, // 3 protection needed but impossible (empty reserve): alert the owner
        ABSTAIN // 4 evidence failed quality gates: refuse to act on bad data
    }

    enum PracticeKind {
        NONE,
        REDEMPTION_ARB, // practice: buy MUSD below peg, redeem at face value for BTC
        HEDGE // practice: short BTC sized to the gap to liquidation
    }

    struct Decision {
        uint64 observedAt; // unix seconds of the evidence snapshot (cron time)
        uint64 mezoBlock; // Mezo block the snapshot was pinned to
        address vault;
        Action action;
        PracticeKind practice;
        uint16 confidenceBps; // 0..10000
        uint32 icrBps; // vault ICR in bps (14758 = 147.58%)
        int32 bullScore;
        int32 bearScore;
        uint128 practiceSize; // MUSD wei (redemption arb) or BTC wei (hedge)
        bytes32 evidenceHash;
        bytes32 policyHash;
        bytes32 reasoningHash;
        uint64 loggedAt;
    }

    struct PolicyInfo {
        bool active;
        uint64 registeredAt;
        string uri; // where the canonical policy JSON is published
    }

    address public owner;
    address public forwarder;
    Decision[] internal _decisions;
    mapping(bytes32 => PolicyInfo) public policies;
    mapping(address => uint64) public lastObservedAt;
    mapping(bytes32 => bool) public evidenceUsed;
    mapping(uint256 => uint256) public disputeCount;

    event PolicyRegistered(bytes32 indexed policyHash, string uri);
    event PolicyRetired(bytes32 indexed policyHash);
    event ForwarderUpdated(address indexed previous, address indexed current);
    event OwnershipTransferred(address indexed previous, address indexed current);
    event DecisionLogged(
        uint256 indexed id,
        address indexed vault,
        Action action,
        PracticeKind practice,
        uint16 confidenceBps,
        uint32 icrBps,
        bytes32 evidenceHash,
        bytes32 policyHash,
        bytes32 reasoningHash
    );
    event DecisionDisputed(uint256 indexed id, address indexed by, bytes32 reasonHash, string note);

    error NotOwner();
    error NotForwarder(address sender);
    error UnknownPolicy(bytes32 policyHash);
    error StaleObservation(uint64 observedAt, uint64 last);
    error EvidenceReplay(bytes32 evidenceHash);
    error BadReport();
    error NoSuchDecision(uint256 id);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address forwarder_) {
        owner = msg.sender;
        forwarder = forwarder_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit ForwarderUpdated(address(0), forwarder_);
    }

    // ------------------------------------------------------------------ admin
    function registerPolicy(bytes32 policyHash, string calldata uri) external onlyOwner {
        policies[policyHash] = PolicyInfo(true, uint64(block.timestamp), uri);
        emit PolicyRegistered(policyHash, uri);
    }

    function retirePolicy(bytes32 policyHash) external onlyOwner {
        policies[policyHash].active = false;
        emit PolicyRetired(policyHash);
    }

    function setForwarder(address f) external onlyOwner {
        emit ForwarderUpdated(forwarder, f);
        forwarder = f;
    }

    function transferOwnership(address o) external onlyOwner {
        emit OwnershipTransferred(owner, o);
        owner = o;
    }

    // ------------------------------------------------------------------ CRE entry point
    /// @inheritdoc IReceiver
    function onReport(bytes calldata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert NotForwarder(msg.sender);
        if (report.length != 13 * 32) revert BadReport();
        Decision memory d;
        (
            d.observedAt,
            d.mezoBlock,
            d.vault,
            d.action,
            d.practice,
            d.confidenceBps,
            d.icrBps,
            d.bullScore,
            d.bearScore,
            d.practiceSize,
            d.evidenceHash,
            d.policyHash,
            d.reasoningHash
        ) = abi.decode(
            report,
            (uint64, uint64, address, Action, PracticeKind, uint16, uint32, int32, int32, uint128, bytes32, bytes32, bytes32)
        );
        if (d.confidenceBps > 10_000 || d.vault == address(0)) revert BadReport();
        if (!policies[d.policyHash].active) revert UnknownPolicy(d.policyHash);
        if (d.observedAt <= lastObservedAt[d.vault]) revert StaleObservation(d.observedAt, lastObservedAt[d.vault]);
        if (evidenceUsed[d.evidenceHash]) revert EvidenceReplay(d.evidenceHash);

        lastObservedAt[d.vault] = d.observedAt;
        evidenceUsed[d.evidenceHash] = true;
        d.loggedAt = uint64(block.timestamp);
        uint256 id = _decisions.length;
        _decisions.push(d);
        emit DecisionLogged(
            id, d.vault, d.action, d.practice, d.confidenceBps, d.icrBps, d.evidenceHash, d.policyHash, d.reasoningHash
        );
    }

    // ------------------------------------------------------------------ disputes
    /// @notice Anyone can contest a logged decision, e.g. after replaying it and getting a different result.
    function dispute(uint256 id, bytes32 reasonHash, string calldata note) external {
        if (id >= _decisions.length) revert NoSuchDecision(id);
        disputeCount[id] += 1;
        emit DecisionDisputed(id, msg.sender, reasonHash, note);
    }

    // ------------------------------------------------------------------ views
    function decisionsCount() external view returns (uint256) {
        return _decisions.length;
    }

    function getDecision(uint256 id) external view returns (Decision memory) {
        if (id >= _decisions.length) revert NoSuchDecision(id);
        return _decisions[id];
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
