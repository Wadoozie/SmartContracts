# Wadoozie Genesis Distribution — Design Spec

**Date:** 2026-04-29
**Topic:** Replace `Wadoozie.sol`'s single-recipient constructor with a six-wallet genesis distribution that mints, dead-address-burns, and seeds five allocation wallets atomically.
**Scope:** `contracts/Wadoozie.sol`, `test/helpers.ts`, `test/Wadoozie.test.ts`, plus any test file that breaks because it references the old `initialHolder` fixture field.

---

## 1. Motivation

The current `Wadoozie.sol` mints the entire 2B supply to a single `initialHolder`. The launch plan requires the supply to be split atomically at deployment across six roles: a deployer (used as the mint anchor), a liquidity-pool wallet, a treasury multisig, a publisher-rewards pool, a signal-fragment prize pool, and a team-vesting timelock. A portion of the supply is also burned to the canonical Ethereum dead address (`0x000…dEaD`) at genesis.

Doing this inside the constructor — with no admin, no Ownable, and no post-deploy migration steps — preserves the truly-immutable property of the existing token while letting the launch ceremony happen in a single transaction.

---

## 2. Constants

```
TOTAL_SUPPLY         = 2_000_000_000 ether
BURN_AT_LAUNCH       =   999_999_999 ether
EFFECTIVE_SUPPLY     = 1_000_000_001 ether     // 1B + 1 in circulation

LP_ALLOCATION        =   750_000_001 ether     // 75% + the +1 ceremony token
TREASURY_ALLOCATION  =   100_000_000 ether     // 10%
PUBLISHER_ALLOCATION =    70_000_000 ether     //  7%
FRAGMENT_ALLOCATION  =    50_000_000 ether     //  5%
TEAM_ALLOCATION      =    30_000_000 ether     //  3%

BURN_ADDRESS         = 0x000000000000000000000000000000000000dEaD
```

**Math:** 999,999,999 + 750,000,001 + 100M + 70M + 50M + 30M = 2,000,000,000 ✓

**Burn semantics:** the burn is a `_transfer` to `BURN_ADDRESS` (`0x…dEaD`), **not** an OpenZeppelin `_burn`. As a result, `totalSupply()` permanently equals `TOTAL_SUPPLY` (2B). The 999,999,999 burned tokens sit in `0x…dEaD` and are unrecoverable because no private key controls that address.

This is the dead-address ("hold-burn") pattern. It was chosen explicitly over `_burn` to address(0). The trade-off — `totalSupply()` does not decrease — is accepted.

---

## 3. Storage

Five new immutable address slots, queryable post-deploy:

```solidity
address public immutable LP_WALLET;
address public immutable TREASURY;
address public immutable PUBLISHER_REWARDS;
address public immutable SIGNAL_FRAGMENTS;
address public immutable TEAM_VESTING;
```

The deployer address is **not** stored — it holds zero balance after the constructor runs and has no role afterward.

---

## 4. Constructor

### Signature

```solidity
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
```

No `Ownable` parent — the contract remains truly immutable, matching the existing pattern.

### Validation

Six zero-address `require`s, one per parameter, with descriptive revert strings (`"Wadoozie: deployer is zero"`, etc.).

### Flow

1. Persist the 5 immutables.
2. `_mint(deployer_, TOTAL_SUPPLY)` — mints 2B to the deployer. Genesis `Transfer(0, deployer_, 2B)` is emitted. Deployer is auto-self-delegated by the existing `_update` override.
3. `_transfer(deployer_, BURN_ADDRESS, BURN_AT_LAUNCH)` — moves 999,999,999 to `0x…dEaD`. Auto-delegation will fire for `0x…dEaD` as well; this is acceptable because no key controls that address (its voting power is permanently dormant).
4. Five sequential `_transfer` calls from `deployer_` to each allocation wallet, in this order:
   - `lpWallet_` ← `LP_ALLOCATION` (750,000,001)
   - `treasury_` ← `TREASURY_ALLOCATION` (100,000,000)
   - `publisherRewards_` ← `PUBLISHER_ALLOCATION` (70,000,000)
   - `signalFragments_` ← `FRAGMENT_ALLOCATION` (50,000,000)
   - `teamVesting_` ← `TEAM_ALLOCATION` (30,000,000)
5. Sanity assertions:
   - `require(balanceOf(deployer_) == 0, "Wadoozie: deployer balance not zero")`
   - `require(totalSupply() == TOTAL_SUPPLY, "Wadoozie: total supply mismatch")`

### Auto-delegation interaction (WAD-04)

The existing `_update` override auto-self-delegates any non-zero recipient on first transfer. Combined with the constructor flow above:

- `deployer_` is self-delegated when the mint happens (then balance drains to 0).
- `BURN_ADDRESS` is self-delegated on the burn transfer. **Voting power dormant** (no key).
- All 5 allocation wallets are self-delegated on first receive. They have voting power immediately at deployment.

This is the explicit design choice. It was reviewed and accepted as informational-only from an audit perspective.

---

## 5. Test Plan

### 5.1 `test/helpers.ts`

**Signers:**
```ts
const [deployer, lpWallet, treasury, publisher, fragment, teamVesting,
       voter1, voter2, voter3] = await ethers.getSigners();
```

**Deploy call:**
```ts
const token = await ethers.deployContract("Wadoozie", [
  deployer.address,
  lpWallet.address,
  treasury.address,
  publisher.address,
  fragment.address,
  teamVesting.address,
]);
```

**Returned fixture object** adds: `lpWallet, treasury, publisher, fragment, teamVesting`. The legacy `initialHolder` field is removed; tests that previously used it switch to `lpWallet` (the largest holder, easiest substitute for transfer tests).

**`TEST_PARAMS` adds:**
```ts
BURN_AT_LAUNCH:        999_999_999n * 10n ** 18n,
EFFECTIVE_SUPPLY:    1_000_000_001n * 10n ** 18n,
LP_ALLOCATION:         750_000_001n * 10n ** 18n,
TREASURY_ALLOCATION:   100_000_000n * 10n ** 18n,
PUBLISHER_ALLOCATION:   70_000_000n * 10n ** 18n,
FRAGMENT_ALLOCATION:    50_000_000n * 10n ** 18n,
TEAM_ALLOCATION:        30_000_000n * 10n ** 18n,
BURN_ADDRESS: "0x000000000000000000000000000000000000dEaD",
```
`TOTAL_SUPPLY` stays at 2B.

### 5.2 `test/Wadoozie.test.ts`

**Modified:**
- Drop "should assign entire supply to initial holder"; replace with per-wallet balance checks below.
- Keep "should have correct total supply" (still 2B).
- Transfer / Permit tests switch from `initialHolder` to `lpWallet` as the source-of-funds signer.
- Votes tests for "zero voting power before delegation" no longer apply to allocation wallets (they are pre-delegated at genesis); replace with checks that confirm pre-delegation. Re-test the original delegation-flip behavior using `voter1`-style fresh accounts.
- WAD-04 auto-delegation tests reuse `lpWallet` as the source and `voter1`/`voter2` as fresh recipients.

**Added — Genesis Distribution describe block:**
- `BURN_ADDRESS` balance equals 999,999,999 ether.
- Each of the 5 allocation wallets holds the exact allocation constant.
- Deployer holds 0.
- Sum of balances = `TOTAL_SUPPLY`.
- All 5 immutable getters (`LP_WALLET`, `TREASURY`, `PUBLISHER_REWARDS`, `SIGNAL_FRAGMENTS`, `TEAM_VESTING`) return the addresses passed in.
- All 5 allocation wallets are self-delegated at genesis with voting power equal to their allocation.
- `BURN_ADDRESS` is self-delegated at genesis with voting power equal to `BURN_AT_LAUNCH` (documents the strict-A behavior we accepted).

**Added — Constructor revert tests:**
- 6 individual tests, one per parameter, each passing `address(0)` for that parameter and asserting the matching revert string.

### 5.3 Other test files

`GovernanceLifecycle.test.ts` and `HeadQuarters.test.ts` will likely break because they consume `initialHolder` from the fixture. They get refactored to use `lpWallet` (which holds 750M+1, more than enough for any vote-power test) or whichever new wallet best matches the test intent. Specific changes determined while running the suite — not pre-planned in this spec.

---

## 6. Out of Scope

- Deployment scripts (`scripts/deploy-*.ts`, `deploy-*.mjs`, `deploy-*.cjs`). They will need updating before any real deployment, but that is launch ceremony work, not part of this contract change.
- `contracts-flat/Wadoozie.sol` regeneration (downstream artifact; regenerated post-merge from the source contract).
- `DEPLOY.md`, `README.md`, contract-reference generation.
- Any change to `Headquarters.sol` or `WadoozieTreasury.sol` — those contracts consume the token by interface only.

---

## 7. Acceptance Criteria

1. `contracts/Wadoozie.sol` compiles and exposes the new constructor signature.
2. `npx hardhat test` passes with all assertions above.
3. `totalSupply()` returns 2,000,000,000 ether.
4. `balanceOf(0x…dEaD)` returns 999,999,999 ether.
5. The 5 allocation balances and immutable getters match the constants.
6. The contract retains: no `mint`, no public `burn`, no `pause`, no `owner`. Existing immutability tests still pass.
