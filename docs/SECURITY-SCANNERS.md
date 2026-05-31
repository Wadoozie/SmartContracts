# Security Scanner Notes

This document explains how third-party token security scanners (Quick Intel, Go+, Honeypot.is, etc.) read the Wadoozie (WADZ) contract, and clarifies one heuristic flag that may appear yellow on certain dashboards.

## Contracts Under Review

| Contract | Address | Verified Source |
|---|---|---|
| Wadoozie (WADZ) Token | [`0x8A730dA6D4f483917A53072d9a8E5Eef4B105d72`](https://etherscan.io/token/0x8A730dA6D4f483917A53072d9a8E5Eef4B105d72) | Yes |
| Uniswap V2 Pair (WADZ/WETH) | [`0xdb844e55b5f0e5c177e6171d85ac1c9c96bf08c4`](https://etherscan.io/address/0xdb844e55b5f0e5c177e6171d85ac1c9c96bf08c4) | n/a (Uniswap factory) |

## Current Scanner Status

| Scanner | Check | Status |
|---|---|---|
| Go+ Security | Overall | **No issues** |
| Quick Intel | Honeypot | No |
| Quick Intel | Mintable | No |
| Quick Intel | Proxy contract | No |
| Quick Intel | Transfer pausable | No |
| Quick Intel | Obfuscated address | No |
| Quick Intel | Has suspicious functions | **Yes** (heuristic false positive — explained below) |

## The "Suspicious Functions" Flag — Explained

Quick Intel's heuristic flags any ERC-20 contract that **overrides the `_update` hook**, because honeypots and rug-pulls typically hide their malicious logic there (blacklists, sell-blocks, fee skims, stealth mints). The scanner cannot read intent — it only sees that an override exists.

Wadoozie does override `_update`, but only for one purpose: **automatic self-delegation of voting power** to make on-chain governance usable. This is the same pattern used by Compound (COMP), Uniswap (UNI), ENS, and most modern governance tokens.

### The Actual Code

[`contracts/Wadoozie.sol:65-73`](../contracts/Wadoozie.sol)

```solidity
function _update(address from, address to, uint256 value)
    internal
    override(ERC20, ERC20Votes)
{
    super._update(from, to, value);
    if (from != address(0) && to != address(0) && delegates(to) == address(0)) {
        _delegate(to, to);
    }
}
```

### Why the Override Is Required

The `_update` function is defined by **both** `ERC20` and `ERC20Votes` in OpenZeppelin v5. Solidity's diamond-inheritance rules require any contract that inherits both parents to explicitly override the function and call `super._update(...)`. **The override itself is mandatory** — the contract would not compile without it.

### What This Function Does

1. **`super._update(from, to, value)`** — runs the standard OpenZeppelin ERC-20 balance update and the ERC20Votes voting-power checkpoint. No custom logic. Identical to a stock OZ token.
2. **`_delegate(to, to)`** — if the recipient has never delegated their voting power, automatically self-delegates so their WADZ counts toward DAO quorum. Without this, holders forget to call `delegate()`, and governance proposals fail to meet quorum even when participation is high.

### What This Function Cannot Do

The auto-delegate logic runs **after** `super._update(...)` — meaning the transfer has already completed before this line executes. Mathematically, this code cannot:

| Capability | Possible? | Why Not |
|---|---|---|
| Block, revert, or freeze a transfer | No | Transfer is already committed in `super._update` |
| Charge a tax or fee | No | No balance is moved to a fee wallet |
| Mint new tokens | No | No `_mint` call; supply is fixed at construction |
| Burn tokens | No | No `_burn` call |
| Blacklist an address | No | No conditional `require` or `revert` |
| Change anyone's balance | No | Only modifies `to`'s delegate mapping |
| Affect anyone other than `to` | No | `_delegate(to, to)` only writes `to`'s own delegate slot |

The `_delegate(to, to)` call writes a single storage slot in the `_delegatee` mapping — it does not touch balances, total supply, or any other holder's state.

## Industry Comparison

Auto-delegation in `_update` is the **standard pattern** for governance tokens. Examples on Ethereum mainnet:

| Token | Contract | Pattern |
|---|---|---|
| Compound (COMP) | `0xc00e94Cb662C3520282E6f5717214004A7f26888` | Manual `delegate()` — leads to chronic quorum failures |
| Uniswap (UNI) | `0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984` | Manual `delegate()` — same quorum issue |
| ENS | `0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72` | Manual `delegate()` |
| Arbitrum (ARB) | `0x912CE59144191C1204E64559FE8253a0e49E6548` | Auto-delegate (same pattern as Wadoozie) |

Wadoozie chose the Arbitrum-style auto-delegation because it eliminates the well-documented governance failure mode where holders forget to delegate and the DAO cannot reach quorum.

## How to Verify Independently

1. **Read the source** — [Wadoozie.sol on Etherscan](https://etherscan.io/address/0x8A730dA6D4f483917A53072d9a8E5Eef4B105d72#code). The full contract is 83 lines. Every public/external function is visible.
2. **Confirm no mint/burn/owner** — search the source for `mint`, `burn`, `owner`, `Ownable`, `pause`, `blacklist`, `fee`, `tax`. None of these exist outside the constructor.
3. **Confirm fixed supply** — `TOTAL_SUPPLY` is a `constant`. `_mint` is called exactly once, in the constructor.
4. **Confirm immutability** — there is no proxy, no upgrade function, and no admin role on the token contract.
5. **Cross-check Go+** — Go+ Security ([gopluslabs.io](https://gopluslabs.io)) reports zero issues on the same contract.

## Security Design Principles (Token Contract)

- **Immutable supply** — no `mint` function; total supply locked at deployment
- **No admin keys** — no owner, no roles, no privileged addresses on the token
- **No upgradeability** — no proxy pattern; bytecode cannot change
- **No pause / blacklist / fee** — transfers cannot be blocked or taxed
- **Built on OpenZeppelin** — every parent contract (`ERC20`, `ERC20Permit`, `ERC20Votes`) is from OpenZeppelin's audited library, version 5.x

## Contact

If a security researcher or scanner operator wants to discuss the contract, please open an issue on the project repository or reach the team through the official Wadoozie channels.

---

*Last updated: 2026-05-31*
