// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

contract Wadoozie is ERC20, ERC20Permit, ERC20Votes {
    uint256 public constant TOTAL_SUPPLY         = 2_000_000_000 ether;
    uint256 public constant BURN_AT_LAUNCH       =   999_999_999 ether;
    uint256 public constant EFFECTIVE_SUPPLY     = 1_000_000_001 ether;

    uint256 public constant LP_ALLOCATION        =   750_000_001 ether;
    uint256 public constant TREASURY_ALLOCATION  =   100_000_000 ether;
    uint256 public constant PUBLISHER_ALLOCATION =    70_000_000 ether;
    uint256 public constant FRAGMENT_ALLOCATION  =    50_000_000 ether;
    uint256 public constant TEAM_ALLOCATION      =    30_000_000 ether;

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    address public immutable LP_WALLET;
    address public immutable TREASURY;
    address public immutable PUBLISHER_REWARDS;
    address public immutable SIGNAL_FRAGMENTS;
    address public immutable TEAM_VESTING;

    constructor(
        address deployer_,
        address lpWallet_,
        address treasury_,
        address publisherRewards_,
        address signalFragments_,
        address teamVesting_
    )
        ERC20("Wadoozie", "WADZ")
        ERC20Permit("Wadoozie")
    {
        require(deployer_         != address(0), "Wadoozie: deployer is zero");
        require(lpWallet_         != address(0), "Wadoozie: lp wallet is zero");
        require(treasury_         != address(0), "Wadoozie: treasury is zero");
        require(publisherRewards_ != address(0), "Wadoozie: publisher rewards is zero");
        require(signalFragments_  != address(0), "Wadoozie: signal fragments is zero");
        require(teamVesting_      != address(0), "Wadoozie: team vesting is zero");

        LP_WALLET         = lpWallet_;
        TREASURY          = treasury_;
        PUBLISHER_REWARDS = publisherRewards_;
        SIGNAL_FRAGMENTS  = signalFragments_;
        TEAM_VESTING      = teamVesting_;

        _mint(deployer_, TOTAL_SUPPLY);

        _transfer(deployer_, BURN_ADDRESS,      BURN_AT_LAUNCH);
        _transfer(deployer_, lpWallet_,         LP_ALLOCATION);
        _transfer(deployer_, treasury_,         TREASURY_ALLOCATION);
        _transfer(deployer_, publisherRewards_, PUBLISHER_ALLOCATION);
        _transfer(deployer_, signalFragments_,  FRAGMENT_ALLOCATION);
        _transfer(deployer_, teamVesting_,      TEAM_ALLOCATION);

        require(balanceOf(deployer_) == 0,      "Wadoozie: deployer balance not zero");
        require(totalSupply() == TOTAL_SUPPLY,  "Wadoozie: total supply mismatch");
    }

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
        if (from != address(0) && to != address(0) && delegates(to) == address(0)) {
            _delegate(to, to);
        }
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
