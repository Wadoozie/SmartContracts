// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title  WadoozieDisperser — stateless batch ERC-20 dispersal helper
/// @notice A direct port of disperse.app's `disperseTokenSimple` (live on
///         mainnet at 0xD152f549545093347A162Dce210e7293f1452150 since 2018).
///         The launchpad deploys one of these per launch and uses it to fan
///         the operational allocations (Treasury, Publisher Rewards, Team) and
///         the 576 Signal Fragment recipients out of the deployer wallet in a
///         small number of chunked transactions, one per chunk. Each chunk
///         must fit under EIP-7825's 16,777,216-gas per-tx cap (Fusaka, live
///         on Ethereum mainnet since 2025-12-03), which limits a single
///         disperse call to roughly ~150 ERC-20 transfers when the recipient
///         is fresh and the token implements ERC20Votes auto-delegation.
/// @dev    Stateless. No owner, no admin, no upgradability, no escape hatch.
///         The contract never holds the token in custody — every transfer is
///         a direct `transferFrom(msg.sender, recipient, amount)` from the
///         deployer wallet, who must `approve()` the disperser for the total
///         dispersal amount before calling. Once dispersal is complete the
///         disperser is inert and can be ignored or self-archived.
contract WadoozieDisperser {
    error LengthMismatch();
    error TransferFailed();

    /// @notice Calls `transferFrom(msg.sender, recipients[i], values[i])` for
    ///         every (recipient, value) pair. Reverts atomically if any
    ///         transfer fails (e.g. insufficient allowance, paused token).
    /// @param  token       The ERC-20 to disperse.
    /// @param  recipients  Recipient addresses; must align 1:1 with `values`.
    /// @param  values      Token amounts (in the token's smallest unit).
    function disperseTokenSimple(
        IERC20 token,
        address[] calldata recipients,
        uint256[] calldata values
    ) external {
        uint256 len = recipients.length;
        if (len != values.length) revert LengthMismatch();
        for (uint256 i; i < len; ++i) {
            if (!token.transferFrom(msg.sender, recipients[i], values[i])) {
                revert TransferFailed();
            }
        }
    }
}
