// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @title Wadoozie — The governance token
/// @notice ERC20 with fixed 1B supply, ERC20Permit for gasless approvals, and ERC20Votes for governance.
///         No mint, no burn, no pause, no owner — fully immutable after deployment.
/// @dev    TESTNET: Token name is "WadTest" / symbol "WADT".
///         MAINNET: Change constructor args to ERC20("Wadoozie", "WADZ") and ERC20Permit("Wadoozie").
contract Wadoozie is ERC20, ERC20Permit, ERC20Votes {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;

    constructor(address initialHolder) ERC20("WadTest", "WADT") ERC20Permit("WadTest") {
        _mint(initialHolder, TOTAL_SUPPLY);
    }

    // ── Required overrides ──────────────────────────────────────────────

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
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
