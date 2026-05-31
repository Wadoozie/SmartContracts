// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Test-only mock of a Uniswap V2 router. Records the last call so
///      tests can assert that the wrapping router (LLTipperRouter,
///      WadoozieFeeRouter, …) forwarded the right value/args, and pays
///      out a pre-registered "amounts" array on each swap function.
///
///      Behaviourally the mock:
///         - For `swapExactETHForTokens`: accepts ETH (held by mock) and
///           sends the last entry of `amountsToReturn` as the output
///           token (path[path.length-1]) to `to`. The mock must hold a
///           balance of that token, funded by the test fixture.
///         - For `swapExactTokensForETH`: pulls input tokens from
///           `msg.sender` via `transferFrom` (caller must have approved
///           the mock), and pays out the last entry of `amountsToReturn`
///           as wei to `to`. The mock must hold ETH (funded by tests).
///         - For `swapExactTokensForTokens`: pulls input + pays output
///           in tokens — needs balance of `path[path.length-1]` held by
///           the mock.
contract MockV2Router {
    using SafeERC20 for IERC20;

    event SwapExactETHForTokensCalled(
        uint256 value,
        uint256 amountOutMin,
        address[] path,
        address to,
        uint256 deadline
    );
    event SwapFeeVariantCalled(
        uint256 value,
        uint256 amountOutMin,
        address[] path,
        address to,
        uint256 deadline
    );
    event SwapExactTokensForETHCalled(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] path,
        address to,
        uint256 deadline
    );
    event SwapExactTokensForTokensCalled(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] path,
        address to,
        uint256 deadline
    );

    bool public shouldRevert;
    uint256[] public amountsToReturn;

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    function setAmountsToReturn(uint256[] calldata a) external {
        delete amountsToReturn;
        for (uint256 i = 0; i < a.length; i++) {
            amountsToReturn.push(a[i]);
        }
    }

    /// @notice WETH stub — some routers call this on themselves to discover
    ///         the wrapped-native address. WadoozieFeeRouter doesn't, but
    ///         keeping it makes the mock interface-compatible.
    function WETH() external pure returns (address) {
        return address(0);
    }

    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts) {
        require(!shouldRevert, "mock revert");
        emit SwapExactETHForTokensCalled(msg.value, amountOutMin, path, to, deadline);
        amounts = _returnAmounts();
        if (amounts.length > 0 && to != address(0) && _hasCode(path[path.length - 1])) {
            // Pay output token to `to`. The mock must hold balance of
            // path[last] — funded by the test fixture before the call.
            // Skipped if path[last] has no code (older tests that used
            // checksummed-but-fake placeholder addresses).
            IERC20(path[path.length - 1]).safeTransfer(to, amounts[amounts.length - 1]);
        }
    }

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable {
        require(!shouldRevert, "mock revert");
        emit SwapFeeVariantCalled(msg.value, amountOutMin, path, to, deadline);
    }

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(!shouldRevert, "mock revert");
        emit SwapExactTokensForETHCalled(amountIn, amountOutMin, path, to, deadline);
        if (_hasCode(path[0])) {
            // Pull input from caller (router-wrapper has already approved
            // us for `amountIn`). Skipped if path[0] has no code (legacy
            // tests with placeholder addresses).
            IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        }
        amounts = _returnAmounts();
        if (amounts.length > 0 && to != address(0)) {
            uint256 out = amounts[amounts.length - 1];
            (bool ok, ) = payable(to).call{value: out}("");
            require(ok, "mock: eth out failed");
        }
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(!shouldRevert, "mock revert");
        emit SwapExactTokensForTokensCalled(amountIn, amountOutMin, path, to, deadline);
        if (_hasCode(path[0])) {
            IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        }
        amounts = _returnAmounts();
        if (amounts.length > 0 && to != address(0) && _hasCode(path[path.length - 1])) {
            IERC20(path[path.length - 1]).safeTransfer(to, amounts[amounts.length - 1]);
        }
    }

    function _hasCode(address account) internal view returns (bool) {
        return account.code.length > 0;
    }

    /// @notice Accept ETH from tests funding the mock for sell-side payouts.
    receive() external payable {}

    function _returnAmounts() internal view returns (uint256[] memory amounts) {
        amounts = new uint256[](amountsToReturn.length);
        for (uint256 i = 0; i < amountsToReturn.length; i++) {
            amounts[i] = amountsToReturn[i];
        }
    }
}
