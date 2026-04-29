// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  WADZ - Wadoozie Token
 * @author Wadoozie Network
 * @notice Native ERC-20 of the Wadoozie ecosystem.
 *         The story comes first; $WADZ exists to make participation in that
 *         story measurable, coordinated, and worth returning to.
 *
 * Tokenomics (frozen at deployment, immutable after renounce):
 *
 *   Total minted at genesis: 2,000,000,000
 *   Burned at launch:        1,000,000,000
 *   Effective supply:        1,000,000,000
 *
 *   Allocation (of the 1B effective supply):
 *     Liquidity Pool:     750,000,000  (75%)  paired with ETH on Uniswap, LP burned post-launch
 *     Treasury:           100,000,000  (10%)  multi-sig, DAO-governed proposals
 *     Publisher Rewards:   70,000,000   (7%)  Publishers Network creator payouts
 *     Signal Fragments:    50,000,000   (5%)  576-fragment tiered prize pool
 *     Team:                30,000,000   (3%)  fully locked for 12 months from launch
 *
 *   Mechanics:
 *     - Tax: 0% buy / 0% sell (no transfer hooks, no tax functions)
 *     - LP: Burned permanently post-launch
 *     - Contract: Ownership renounced post-launch (no admin functions remain)
 *     - Audit: CertiK pre-launch
 *
 * @dev OpenZeppelin v5 ERC20 + Burnable + Permit + Ownable. Distribution happens
 *      atomically inside the constructor in three steps:
 *        1. Mint full 2B to the deployer (genesis Transfer event from address(0))
 *        2. Burn 1B from the deployer (genesis Transfer event to address(0))
 *        3. Distribute the remaining 1B effective supply to the 5 allocation wallets
 *
 *      Post-deployment, the launch operator MUST:
 *        1. Pair LP_WALLET's 750M WADZ with ETH on Uniswap V2 (or V3)
 *        2. Burn the LP receipt tokens (transfer to 0x000...dEaD)
 *        3. Renounce ownership of this contract via renounceOwnership()
 */
contract WADZ is ERC20, ERC20Burnable, ERC20Permit, Ownable {
    // =========================================================================
    //                                CONSTANTS
    // =========================================================================

    uint256 public constant TOTAL_SUPPLY         = 2_000_000_000 ether;
    uint256 public constant BURN_AT_LAUNCH       = 1_000_000_000 ether;
    uint256 public constant EFFECTIVE_SUPPLY     = 1_000_000_000 ether;

    uint256 public constant LP_ALLOCATION        =   750_000_000 ether; // 75%
    uint256 public constant TREASURY_ALLOCATION  =   100_000_000 ether; // 10%
    uint256 public constant PUBLISHER_ALLOCATION =    70_000_000 ether; //  7%
    uint256 public constant FRAGMENT_ALLOCATION  =    50_000_000 ether; //  5%
    uint256 public constant TEAM_ALLOCATION      =    30_000_000 ether; //  3%

    // =========================================================================
    //              IMMUTABLE ALLOCATION RECIPIENTS (queryable)
    // =========================================================================

    address public immutable LP_WALLET;
    address public immutable TREASURY;
    address public immutable PUBLISHER_REWARDS;
    address public immutable SIGNAL_FRAGMENTS;
    address public immutable TEAM_VESTING;

    // =========================================================================
    //                              CONSTRUCTOR
    // =========================================================================

    /**
     * @param deployer_         The launch operator. Receives 2B, burns 1B, distributes 1B.
     *                          After the constructor finishes, the deployer holds 0 WADZ.
     *                          Retains owner role until renounceOwnership() is called.
     * @param lpWallet_         EOA that will pair the 750M LP allocation with ETH on Uniswap
     *                          immediately post-deployment. The LP receipt tokens are burned
     *                          (sent to 0x...dEaD) once the pair is created.
     * @param treasury_         Multi-sig wallet (e.g. Gnosis Safe) under DAO governance.
     *                          Receives the 100M Treasury allocation. All spends require
     *                          community proposal + vote.
     * @param publisherRewards_ Pool wallet (multi-sig recommended) for the Publishers Network.
     *                          Receives the 70M creator-rewards allocation.
     * @param signalFragments_  Pool wallet (multi-sig recommended) for fragment recoveries.
     *                          Receives the 50M Signal Fragment prize pool.
     * @param teamVesting_      Timelock contract holding the 30M team allocation under a
     *                          12-month lock from launch.
     */
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
        Ownable(deployer_)
    {
        require(deployer_         != address(0), "WADZ: deployer is zero");
        require(lpWallet_         != address(0), "WADZ: lp wallet is zero");
        require(treasury_         != address(0), "WADZ: treasury is zero");
        require(publisherRewards_ != address(0), "WADZ: publisher rewards is zero");
        require(signalFragments_  != address(0), "WADZ: signal fragments is zero");
        require(teamVesting_      != address(0), "WADZ: team vesting is zero");

        LP_WALLET         = lpWallet_;
        TREASURY          = treasury_;
        PUBLISHER_REWARDS = publisherRewards_;
        SIGNAL_FRAGMENTS  = signalFragments_;
        TEAM_VESTING      = teamVesting_;

        // Step 1: genesis mint of 2B to the deployer
        _mint(deployer_, TOTAL_SUPPLY);

        // Step 2: genesis burn of 1B from the deployer
        //         (emits Transfer(deployer, address(0), 1_000_000_000))
        _burn(deployer_, BURN_AT_LAUNCH);

        // Step 3: distribute the remaining 1B effective supply
        _transfer(deployer_, lpWallet_,         LP_ALLOCATION);
        _transfer(deployer_, treasury_,         TREASURY_ALLOCATION);
        _transfer(deployer_, publisherRewards_, PUBLISHER_ALLOCATION);
        _transfer(deployer_, signalFragments_,  FRAGMENT_ALLOCATION);
        _transfer(deployer_, teamVesting_,      TEAM_ALLOCATION);

        // Sanity assertions: deployer must hold zero, total supply must equal effective supply
        require(balanceOf(deployer_) == 0,         "WADZ: deployer balance not zero");
        require(totalSupply() == EFFECTIVE_SUPPLY, "WADZ: total supply mismatch");
    }
}
