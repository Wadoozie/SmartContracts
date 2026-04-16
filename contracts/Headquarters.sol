// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Governor} from "@openzeppelin/contracts/governance/Governor.sol";
import {GovernorSettings} from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import {GovernorCountingSimple} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {GovernorVotes} from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {GovernorVotesQuorumFraction} from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import {GovernorTimelockControl} from "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import {GovernorPreventLateQuorum} from "@openzeppelin/contracts/governance/extensions/GovernorPreventLateQuorum.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title Headquarters — Where the mission is decided
/// @notice This is Headquarters. You vote here. You decide what happens next.
///         Every proposal is a new direction. Every vote shapes the journey.
///         You're not just voting — you're steering the whole thing.
///         Headquarters is always moving. Headquarters is wherever we need it to be.
/// @dev    No privileged roles. No guardian. No admin. Fully decentralized governance.
///         Only proposers can cancel their own Pending proposals (base Governor behavior).
contract Headquarters is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl,
    GovernorPreventLateQuorum
{
    /// @dev Thrown when updateTimelock is called. Timelock migration is permanently disabled
    ///      to prevent desynchronization between queued proposals and the active timelock.
    ///      Deploy a new governor if a new timelock is needed.
    error HeadquartersTimelockImmutable();

    /// @param _token         ERC20Votes governance token
    /// @param _timelock      TimelockController used for proposal execution delay
    /// @param _votingDelay   Blocks between proposal creation and vote start
    /// @param _votingPeriod  Blocks the voting window stays open
    /// @param _proposalThreshold Minimum voting power required to create a proposal (token units, 18 decimals)
    /// @param _quorumPercent Percentage of total supply required for quorum (e.g., 4 = 4%)
    /// @param _voteExtension Minimum blocks of voting time remaining after quorum is first reached
    constructor(
        IVotes _token,
        TimelockController _timelock,
        uint48 _votingDelay,
        uint32 _votingPeriod,
        uint256 _proposalThreshold,
        uint256 _quorumPercent,
        uint48 _voteExtension
    )
        Governor("Headquarters")
        GovernorSettings(_votingDelay, _votingPeriod, _proposalThreshold)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(_quorumPercent)
        GovernorTimelockControl(_timelock)
        GovernorPreventLateQuorum(_voteExtension)
    {}

    // ── Timelock migration disabled ──────────────────────────────────────
    //
    // GovernorTimelockControl exposes updateTimelock() which allows swapping
    // the timelock via governance. This creates a desync: proposals queued on
    // the old timelock become unmanageable through the governor, and with open
    // executor permissions (address(0)), stale batches can be executed directly.
    // We disable this entirely — deploy a new governor if migration is needed.

    function updateTimelock(TimelockController) public virtual override {
        revert HeadquartersTimelockImmutable();
    }

    // ── Required overrides ──────────────────────────────────────────────

    function votingDelay()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.votingDelay();
    }

    function votingPeriod()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.votingPeriod();
    }

    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    function proposalDeadline(uint256 proposalId)
        public
        view
        override(Governor, GovernorPreventLateQuorum)
        returns (uint256)
    {
        return super.proposalDeadline(proposalId);
    }

    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function proposalNeedsQueuing(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.proposalNeedsQueuing(proposalId);
    }

    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(Governor, GovernorTimelockControl)
        returns (uint48)
    {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(Governor, GovernorTimelockControl)
    {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(Governor, GovernorTimelockControl)
        returns (uint256)
    {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _tallyUpdated(uint256 proposalId)
        internal
        override(Governor, GovernorPreventLateQuorum)
    {
        super._tallyUpdated(proposalId);
    }

    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return super._executor();
    }
}
