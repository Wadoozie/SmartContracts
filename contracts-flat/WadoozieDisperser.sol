// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

// File npm/@openzeppelin/contracts@5.6.1/token/ERC20/IERC20.sol

// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC20/IERC20.sol)

/**
 * @dev Interface of the ERC-20 standard as defined in the ERC.
 */
interface IERC20 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @dev Returns the value of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the value of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 value) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the
     * allowance mechanism. `value` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

// File contracts/WadoozieDisperser.sol

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

