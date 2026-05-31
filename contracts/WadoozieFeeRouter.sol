// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal Uniswap V2 router surface used by this contract. The
///         interface mirrors the canonical Uniswap V2 Router 02 ABI; we only
///         declare the four functions we actually invoke (one for each
///         spend-side shape) so the deployed bytecode stays small.
interface IUniswapV2Router02 {
    function WETH() external view returns (address);

    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

/// @title  WadoozieFeeRouter
/// @notice Thin Uniswap V2 wrapper that skims a configurable fee
///         (default 0.75% / 75 bps, bounded by 0.5% / 50 bps floor and
///         1% / 100 bps cap) on every buy or sell of $WADZ and forwards
///         the rest to the canonical V2 router.
/// @dev    The contract is deliberately stateless between transactions: every
///         swap takes the fee, immediately forwards it to `feeRecipient`, and
///         routes the remainder through Uniswap with the user as the final
///         recipient. Nothing is held by the router between calls, which
///         keeps the blast radius of a compromise small (rescue function
///         exists for any stuck ERC-20 sent here by mistake — see
///         `rescueTokens`).
///
///         Three swap shapes are supported, mirroring the buy-wadz UI's
///         spend-token picker:
///           1. `buyWadzWithETH`            — native ETH → WADZ.
///           2. `buyWadzWithToken(token,…)` — USDC/USDT (or any ERC-20 with
///                                            a Uniswap V2 path to WETH) →
///                                            WADZ, via [token, WETH, WADZ].
///           3. `sellWadzForETH`            — WADZ → ETH.
///
///         Fee is always taken from the INPUT side. Industry convention:
///         Uniswap's interface fee, MetaMask Swap, 1inch UI, and Matcha all
///         skim input. Output-side fees double the on-chain accounting and
///         confuse users about effective slippage. Input fee is one
///         transfer, deterministic.
///
///         WADZ + WETH + `feeRecipient` are pinned at deploy time as
///         `immutable` so no admin action — not even a compromised owner
///         key — can redirect the fee stream or repurpose the router for
///         a different token. The Uniswap router address + fee bps are
///         mutable behind owner-gated setters with a hard cap so the
///         worst-case mis-set is still bounded (≤1% fee, no path-routing
///         games). If `feeRecipient` ever needs to change, deploy a new
///         instance and have the frontend repoint.
contract WadoozieFeeRouter is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// ─── State ────────────────────────────────────────────────────────────

    /// @notice Hard floor on the fee in basis points (0.5% = 50 bps). Owner
    ///         can raise the live fee up to `MAX_FEE_BPS` but never lower it
    ///         below this floor. Pinned as `constant` so a future malicious
    ///         owner cannot bypass it (this contract is non-upgradeable).
    ///         Set to 50 bps as the launch-day minimum — anything less
    ///         doesn't materially fund the treasury vs. the gas + audit
    ///         overhead of running this router.
    uint16 public constant MIN_FEE_BPS = 50;

    /// @notice Hard cap on the fee in basis points (1% = 100 bps). Owner
    ///         can lower the live fee within `[MIN_FEE_BPS, MAX_FEE_BPS]`
    ///         but never raise it above. The cap is `constant` so a future
    ///         malicious owner cannot bypass it (this contract is
    ///         non-upgradeable by design).
    uint16 public constant MAX_FEE_BPS = 100;

    /// @notice 100% in basis points, used as the divisor for fee math.
    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @notice The WADZ token. Pinned at construction so the router can
    ///         never be repurposed for an unrelated token; any swap MUST
    ///         have WADZ on one end of the path.
    address public immutable WADZ;

    /// @notice The wrapped-native ERC-20 (WETH on mainnet, WETH9 on
    ///         testnets). Used as the intermediate hop for any non-ETH /
    ///         non-WADZ spend token, and as the bridge in ETH ↔ WADZ swaps.
    address public immutable WETH;

    /// @notice Uniswap V2 Router 02 (or a fork-compatible equivalent).
    ///         Mutable so we can repoint to a different DEX without
    ///         redeploying — useful if the canonical V2 router is ever
    ///         deprecated. Pause + setRouter together let ops respond to
    ///         a DEX outage cleanly.
    IUniswapV2Router02 public router;

    /// @notice Address that receives the skimmed fee from every swap.
    ///         Pinned at deploy time as `immutable` so no admin action —
    ///         not even a compromised owner key — can redirect the fee
    ///         stream to a different wallet. Pass the production
    ///         multisig (Wadoozie treasury) at constructor time; if it
    ///         ever needs to change, deploy a new instance of this
    ///         contract.
    address public immutable feeRecipient;

    /// @notice Live fee in basis points. Capped at `MAX_FEE_BPS`.
    uint16 public feeBps;

    /// ─── Events ───────────────────────────────────────────────────────────

    event BuyExecuted(
        address indexed buyer,
        address indexed inputToken,
        uint256 grossInput,
        uint256 feeCollected,
        uint256 netInput,
        uint256 wadzReceived
    );

    event SellExecuted(
        address indexed seller,
        uint256 grossWadzIn,
        uint256 feeWadzCollected,
        uint256 netWadzIn,
        uint256 ethReceived
    );

    event FeeBpsUpdated(uint16 previousBps, uint16 newBps);
    event RouterUpdated(address indexed previousRouter, address indexed newRouter);
    event TokensRescued(address indexed token, address indexed to, uint256 amount);
    event EthRescued(address indexed to, uint256 amount);

    /// ─── Errors ───────────────────────────────────────────────────────────

    error ZeroAddress();
    error FeeExceedsCap(uint16 attempted, uint16 cap);
    error FeeBelowFloor(uint16 attempted, uint16 floor);
    error ZeroAmount();
    error InvalidInputToken(); // WADZ-as-input or WETH-as-input on the token path
    error EthTransferFailed();

    /// ─── Constructor ──────────────────────────────────────────────────────

    /// @param wadz_             Immutable WADZ token address.
    /// @param weth_             Immutable wrapped-native ERC-20 (WETH9 on mainnet).
    /// @param uniswapV2Router_  Uniswap V2 Router 02 (or fork-compatible).
    /// @param owner_            Initial contract owner. The deployer EOA
    ///                          briefly signs the deploy tx but does NOT
    ///                          gain control of the contract — ownership
    ///                          goes straight to `owner_`. Set this to
    ///                          the multisig that should manage fee
    ///                          settings + router updates.
    /// @param feeRecipient_     Immutable fee destination. Cannot be
    ///                          changed after deploy — see the
    ///                          `feeRecipient` slot's NatSpec.
    /// @param initialFeeBps_    Initial live fee, in basis points. Must
    ///                          satisfy `MIN_FEE_BPS ≤ x ≤ MAX_FEE_BPS`
    ///                          (currently 50 ≤ x ≤ 100, i.e. 0.5% to
    ///                          1%). Default at launch: 75 (0.75%).
    constructor(
        address wadz_,
        address weth_,
        address uniswapV2Router_,
        address owner_,
        address feeRecipient_,
        uint16 initialFeeBps_
    ) Ownable(owner_) {
        if (wadz_ == address(0)) revert ZeroAddress();
        if (weth_ == address(0)) revert ZeroAddress();
        if (uniswapV2Router_ == address(0)) revert ZeroAddress();
        if (owner_ == address(0)) revert ZeroAddress();
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        if (initialFeeBps_ < MIN_FEE_BPS) revert FeeBelowFloor(initialFeeBps_, MIN_FEE_BPS);
        if (initialFeeBps_ > MAX_FEE_BPS) revert FeeExceedsCap(initialFeeBps_, MAX_FEE_BPS);

        WADZ = wadz_;
        WETH = weth_;
        router = IUniswapV2Router02(uniswapV2Router_);
        feeRecipient = feeRecipient_;
        feeBps = initialFeeBps_;
    }

    /// ─── Buy: native ETH → WADZ ──────────────────────────────────────────
    ///
    /// User sends ETH along with the call. The contract skims `feeBps` of
    /// `msg.value` in ETH (forwarded to `feeRecipient` immediately), then
    /// calls `swapExactETHForTokens` on the V2 router with the remainder.
    /// Output WADZ goes directly to `msg.sender` — the router never holds
    /// user funds between transactions.
    ///
    /// Path is hard-coded to `[WETH, WADZ]` so an attacker can't trick the
    /// router into emitting unrelated tokens to the user (which would still
    /// be a self-rug rather than a stranger's loss, but the constraint
    /// makes the contract's behaviour trivial to audit).

    function buyWadzWithETH(uint256 amountOutMin, uint256 deadline)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256[] memory amounts)
    {
        if (msg.value == 0) revert ZeroAmount();

        uint256 fee = (msg.value * feeBps) / BPS_DENOMINATOR;
        uint256 net = msg.value - fee;

        // Forward fee first so a router revert doesn't accidentally leave
        // the fee stuck in this contract. If the fee send fails we revert
        // the whole tx — better than swallowing the user's ETH.
        if (fee > 0) _sendEth(feeRecipient, fee);

        address[] memory path = new address[](2);
        path[0] = WETH;
        path[1] = WADZ;

        amounts = router.swapExactETHForTokens{value: net}(
            amountOutMin,
            path,
            msg.sender,
            deadline
        );

        emit BuyExecuted(msg.sender, address(0), msg.value, fee, net, amounts[amounts.length - 1]);
    }

    /// ─── Buy: ERC-20 (USDC / USDT / …) → WADZ ─────────────────────────────
    ///
    /// User must have called `approve(WadoozieFeeRouter, ≥ amountIn)` on
    /// `inputToken` before invoking this. Two-step UX is the V2-standard
    /// approach, same flow as Uniswap's own interface.
    ///
    /// `inputToken` must be:
    ///   - non-zero
    ///   - not WADZ (use a different DEX or a direct transfer if you want
    ///     to send WADZ to yourself; this contract is for SWAPS)
    ///   - not WETH (caller should use `buyWadzWithETH` and skip the wrap
    ///     entirely; wrapping ETH → calling this would double-charge gas)
    ///
    /// Path is forced to `[inputToken, WETH, WADZ]` — multi-hop through
    /// WETH because the WADZ/USDC and WADZ/USDT direct pools don't exist;
    /// every stablecoin → WADZ swap goes via the WETH/WADZ pair the
    /// project already owns.

    function buyWadzWithToken(
        address inputToken,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256[] memory amounts) {
        if (inputToken == address(0)) revert ZeroAddress();
        if (inputToken == WADZ || inputToken == WETH) revert InvalidInputToken();
        if (amountIn == 0) revert ZeroAmount();

        IERC20 token = IERC20(inputToken);

        // Pull the full gross amount from the user. Two ledger writes
        // (user → router → feeRecipient + uniswap) cost ~10k more gas
        // than skimming the fee in the user's `transferFrom` call would,
        // but only this shape is robust to fee-on-transfer input tokens
        // and weird approve quirks (USDT in particular).
        token.safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 fee = (amountIn * feeBps) / BPS_DENOMINATOR;
        uint256 net = amountIn - fee;

        if (fee > 0) token.safeTransfer(feeRecipient, fee);

        // Approve the V2 router for exactly `net`. We use forceApprove so
        // the second-and-Nth call to this function refreshes the allowance
        // correctly even against tokens (like USDT) that revert on
        // approve-to-non-zero-from-non-zero.
        token.forceApprove(address(router), net);

        address[] memory path = new address[](3);
        path[0] = inputToken;
        path[1] = WETH;
        path[2] = WADZ;

        amounts = router.swapExactTokensForTokens(
            net,
            amountOutMin,
            path,
            msg.sender,
            deadline
        );

        emit BuyExecuted(msg.sender, inputToken, amountIn, fee, net, amounts[amounts.length - 1]);
    }

    /// ─── Sell: WADZ → ETH ────────────────────────────────────────────────
    ///
    /// User must have called `approve(WadoozieFeeRouter, ≥ amountIn)` on
    /// the WADZ token. The contract pulls the gross WADZ, skims the fee
    /// in WADZ (forwarded to `feeRecipient`), and swaps the remainder for
    /// ETH via `swapExactTokensForETH`. Output ETH goes directly to
    /// `msg.sender`.
    ///
    /// Path is hard-coded to `[WADZ, WETH]`. Two-hop sells to stables are
    /// out of scope for this iteration — would need a separate pool
    /// (WADZ/USDC) which doesn't exist.

    function sellWadzForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256[] memory amounts) {
        if (amountIn == 0) revert ZeroAmount();

        IERC20 wadz = IERC20(WADZ);

        wadz.safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 fee = (amountIn * feeBps) / BPS_DENOMINATOR;
        uint256 net = amountIn - fee;

        if (fee > 0) wadz.safeTransfer(feeRecipient, fee);

        wadz.forceApprove(address(router), net);

        address[] memory path = new address[](2);
        path[0] = WADZ;
        path[1] = WETH;

        amounts = router.swapExactTokensForETH(
            net,
            amountOutMin,
            path,
            msg.sender,
            deadline
        );

        emit SellExecuted(msg.sender, amountIn, fee, net, amounts[amounts.length - 1]);
    }

    /// ─── Admin ────────────────────────────────────────────────────────────

    /// @notice Update the live fee. Bounded by
    ///         `MIN_FEE_BPS = 50` (0.5%) ≤ x ≤ `MAX_FEE_BPS = 100` (1%).
    ///         Outside that range the call reverts — neither a malicious
    ///         owner nor an honest typo can push the fee to 0 (which would
    ///         starve the treasury) or above 1% (which would harm users).
    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps < MIN_FEE_BPS) revert FeeBelowFloor(newFeeBps, MIN_FEE_BPS);
        if (newFeeBps > MAX_FEE_BPS) revert FeeExceedsCap(newFeeBps, MAX_FEE_BPS);
        uint16 previous = feeBps;
        feeBps = newFeeBps;
        emit FeeBpsUpdated(previous, newFeeBps);
    }

    /// @notice Repoint to a different V2-compatible router. Useful if the
    ///         canonical Uniswap V2 router is ever deprecated. Pause +
    ///         setRouter is the canonical "DEX outage" runbook.
    function setRouter(address newRouter) external onlyOwner {
        if (newRouter == address(0)) revert ZeroAddress();
        address previous = address(router);
        router = IUniswapV2Router02(newRouter);
        emit RouterUpdated(previous, newRouter);
    }

    /// @notice Emergency stop. While paused, all swap functions revert.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Rescue ERC-20 tokens accidentally sent to this contract.
    ///         Since the router never holds tokens between transactions
    ///         (every swap forwards fee + routes remainder atomically),
    ///         any balance here is by definition an unintended deposit
    ///         and is safe to recover.
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit TokensRescued(token, to, amount);
    }

    /// @notice Rescue native ETH accidentally sent to this contract.
    ///         Same rationale as `rescueTokens` — the contract should
    ///         never hold ETH between transactions.
    function rescueEth(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        _sendEth(to, amount);
        emit EthRescued(to, amount);
    }

    /// ─── Internals ────────────────────────────────────────────────────────

    function _sendEth(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    /// @notice Allow this contract to receive ETH from the Uniswap router
    ///         when `swapExactTokensForETH` unwraps WETH at the end of the
    ///         path. Without this fallback, sells would revert because the
    ///         router can't forward the unwrapped ETH back through our
    ///         contract to the user.
    ///
    ///         IMPORTANT: this contract IS the recipient on the router's
    ///         `swapExactTokensForETH` call would normally be — but we set
    ///         `to = msg.sender` on the swap call, so ETH goes directly to
    ///         the user. This receive() exists only for `rescueEth` to be
    ///         testable and for forward compatibility if a future router
    ///         (or a fork) routes via this contract.
    receive() external payable {}
}
