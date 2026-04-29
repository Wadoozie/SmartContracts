# Mainnet Deployment Guide — Flattened Contracts

End-to-end runbook for deploying the three Wadoozie contracts (`Wadoozie`, `WadoozieTreasury`, `Headquarters`) to **Ethereum mainnet** from flat-source files and verifying them on Etherscan.

The flat sources are compiled directly with `solc@0.8.28` so the on-chain bytecode is provably from the single-file source — Etherscan single-file verification then displays each contract as one clean file.

---

## 0. Prerequisites

- Node.js 22+
- Hardhat 3 project installed (`npm install`)
- Funded mainnet deployer key (~0.15–0.25 ETH at moderate gas; gas spikes can push higher — top up before starting)
- Mainnet RPC URL (Alchemy, Infura, QuickNode, etc.)
- Etherscan API key
- Hardware wallet or a temporary hot wallet you control — **never reuse a hot wallet beyond this deploy**

---

## 1. Configure environment

Create or update `.env` in the repo root:

```bash
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<key>
DEPLOYER_PRIVATE_KEY=0x<your_deployer_key>
ETHERSCAN_API_KEY=<your_etherscan_v2_api_key>

# Required: six wallet addresses for the genesis distribution.
# All five allocation wallets must be set — there is no admin to fix
# them later. Use multisigs for everything except LP_WALLET (which will
# immediately pair with ETH on Uniswap post-deploy).
LP_WALLET=0x<lp_wallet_address>                 # 750,000,001 WADZ
TREASURY=0x<treasury_multisig>                  # 100,000,000 WADZ
PUBLISHER_REWARDS=0x<publisher_rewards_multisig> #  70,000,000 WADZ
SIGNAL_FRAGMENTS=0x<signal_fragments_multisig>  #  50,000,000 WADZ
TEAM_VESTING=0x<team_vesting_timelock>          #  30,000,000 WADZ
```

> **Important** — These addresses are baked into immutable storage by the constructor and **cannot be changed afterward**. Double-check every value before deploying. The deployer signer briefly holds 2,000,000,000 WADZ during the constructor and drains to zero before the tx ends; you do not need a separate "initial holder" address.

> **Burn semantics** — 999,999,999 WADZ is transferred to `0x000…dEaD` inside the constructor. `totalSupply()` permanently equals 2,000,000,000; the burn does not decrease it. The single ceremony token (the `+1`) is added to `LP_WALLET`'s allocation, so `LP_WALLET` receives 750,000,001 WADZ.

---

## 2. Pre-flight checks

Run all of these on a fresh clone before mainnet:

```bash
npm install
npm run compile        # solc 0.8.28, optimizer 200 runs, evm cancun
npm run test           # full 79-test governance suite must pass
npm run flatten        # regenerate contracts-flat/{Wadoozie,WadoozieTreasury,Headquarters}.sol
```

You should see:

```
79 passing
contracts-flat/Wadoozie.sol         (~224 KB)
contracts-flat/WadoozieTreasury.sol (~ 48 KB)
contracts-flat/Headquarters.sol     (~323 KB)
```

Optionally do a dry-run on Sepolia first:

```bash
npm run deploy:flat:sepolia
npm run verify:flat:sepolia
```

---

## 3. Review deploy parameters

`scripts/deploy-flat.mjs` uses these production values:

| Parameter           | Value                | Meaning                                 |
| ------------------- | -------------------- | --------------------------------------- |
| `votingDelay`       | 7 200 blocks (~1d)   | Delay between proposal creation and vote |
| `votingPeriod`      | 50 400 blocks (~7d)  | Length of the voting window             |
| `proposalThreshold` | 1 000 WADZ           | Tokens required to create a proposal    |
| `quorumNumerator`   | 350                  | Numerator for 3.5 % quorum              |
| `quorumDenominator` | 10 000               | (Hard-coded in `Headquarters`)          |
| `voteExtension`     | 7 200 blocks (~1d)   | Late-quorum protection window           |
| `timelockDelay`     | 86 400 sec (1 day)   | Delay before queued proposals execute   |

If any of these need adjustment, edit the constants at the top of `scripts/deploy-flat.mjs` **before** deploying.

---

## 4. Deploy

> ⚠️ **Action required before mainnet:** `scripts/deploy-flat.mjs` currently calls the old single-argument `Wadoozie.deploy(initialHolder)`. The new constructor takes six arguments. Update the script to read `LP_WALLET` / `TREASURY` / `PUBLISHER_REWARDS` / `SIGNAL_FRAGMENTS` / `TEAM_VESTING` from `process.env` and pass them to `Wadoozie.deploy(deployer.address, ...)` before running on mainnet. Also regenerate `contracts-flat/Wadoozie.sol` with `npm run flatten` so the flat source matches the new contract.

```bash
npm run deploy:flat:mainnet
```

What it does (in order):

1. Compiles `contracts-flat/Wadoozie.sol` with solc 0.8.28 and deploys it with the six wallet addresses (`deployer`, `LP_WALLET`, `TREASURY`, `PUBLISHER_REWARDS`, `SIGNAL_FRAGMENTS`, `TEAM_VESTING`). The constructor mints 2B WADZ to the deployer, transfers 999,999,999 to `0x000…dEaD`, then distributes the remaining 1,000,000,001 across the five allocation wallets — atomically, in one transaction. Deployer drains to zero before the tx returns.
2. Compiles `contracts-flat/WadoozieTreasury.sol` and deploys it with:
   - `minDelay = 86400`
   - `proposers = []`
   - `executors = [address(0)]` (anyone can execute queued proposals)
   - `admin = deployer` (revoked in step 5)
3. Compiles `contracts-flat/Headquarters.sol` and deploys it wired to the token + treasury.
4. Grants `PROPOSER_ROLE` and `CANCELLER_ROLE` on the treasury to the governor.
5. Renounces `DEFAULT_ADMIN_ROLE` from the deployer.

When it finishes, the three addresses are written to `deployments-flat/mainnet.json`. Save and back up that file — it's the input to verification.

Expected console output (ends with):

```
============================================================
DEPLOYMENT COMPLETE
============================================================
Wadoozie         0x...
WadoozieTreasury 0x...
Headquarters     0x...

Saved → deployments-flat/mainnet.json
```

---

## 5. Sanity-check on chain (recommended)

Before announcing addresses publicly, confirm on Etherscan that each contract:

- Token:
  - `totalSupply()` returns 2 000 000 000 × 10^18 (the burn does not decrease total supply)
  - `balanceOf(0x000…dEaD)` returns 999 999 999 × 10^18
  - `balanceOf(LP_WALLET)` returns 750 000 001 × 10^18
  - `balanceOf(TREASURY)` returns 100 000 000 × 10^18
  - `balanceOf(PUBLISHER_REWARDS)` returns 70 000 000 × 10^18
  - `balanceOf(SIGNAL_FRAGMENTS)` returns 50 000 000 × 10^18
  - `balanceOf(TEAM_VESTING)` returns 30 000 000 × 10^18
  - `balanceOf(<deployer>)` returns 0
  - The five immutable getters (`LP_WALLET`, `TREASURY`, `PUBLISHER_REWARDS`, `SIGNAL_FRAGMENTS`, `TEAM_VESTING`) return the addresses you intended
- Treasury: deployer **no longer** has `DEFAULT_ADMIN_ROLE`. Governor has `PROPOSER_ROLE` + `CANCELLER_ROLE`.
- Headquarters: `quorumNumerator()` returns 350, `quorumDenominator()` returns 10000, `votingDelay()` returns 7200, `votingPeriod()` returns 50400.

Quick CLI check via `cast` (if installed):

```bash
cast call <Wadoozie>     "totalSupply()(uint256)"                           --rpc-url $ETHEREUM_RPC_URL
cast call <Wadoozie>     "balanceOf(address)(uint256)" 0x000000000000000000000000000000000000dEaD --rpc-url $ETHEREUM_RPC_URL
cast call <Wadoozie>     "LP_WALLET()(address)"                             --rpc-url $ETHEREUM_RPC_URL
cast call <Headquarters> "quorumNumerator()(uint256)"                       --rpc-url $ETHEREUM_RPC_URL
cast call <Headquarters> "quorumDenominator()(uint256)"                     --rpc-url $ETHEREUM_RPC_URL
```

---

## 6. Verify on Etherscan (automated)

```bash
npm run verify:flat:mainnet
```

This reads `deployments-flat/mainnet.json` and submits each flat source to the Etherscan v2 API with:

- Compiler: `v0.8.28+commit.7893614a`
- Optimizer: enabled, 200 runs
- EVM version: `cancun`
- License: MIT (`licenseType=3`)
- Format: `solidity-single-file`
- Constructor arguments: ABI-encoded automatically from the deployment record

The script polls verification status and prints `✓` for each contract.

If a submission fails, the script will print the Etherscan error message. The two most common reasons for failure are:

| Error                          | Cause                                   | Fix                                         |
| ------------------------------ | --------------------------------------- | ------------------------------------------- |
| `Bytecode does not match…`     | Solc / optimizer / evm settings drifted | Confirm `hardhat.config.ts` still has 0.8.28 / 200 / cancun, re-flatten, redeploy if needed |
| `Already Verified`             | Etherscan already has this contract     | Safe to ignore                              |

---

## 7. Manual fallback verification

If the automated script can't reach Etherscan or you prefer the UI:

1. Open the deployed contract on `https://etherscan.io/address/<contract>`.
2. Click **Contract → Verify and Publish**.
3. Choose:
   - **Compiler Type**: *Solidity (Single file)*
   - **Compiler Version**: `v0.8.28+commit.7893614a`
   - **Open Source License Type**: *MIT License (MIT)*
4. Click *Continue*.
5. Settings on the next page:
   - **Optimization**: *Yes*, runs `200`
   - **EVM Version**: `cancun`
6. Paste the entire contents of `contracts-flat/<Name>.sol` into the source code box.
7. Constructor arguments — paste the ABI-encoded hex (without the `0x` prefix). Get them with:

   ```bash
   node -e "
     const { AbiCoder } = require('ethers');
     const enc = AbiCoder.defaultAbiCoder();
     // Wadoozie:
     console.log('Wadoozie:', enc.encode(
       ['address','address','address','address','address','address'],
       ['<DEPLOYER>','<LP_WALLET>','<TREASURY>','<PUBLISHER_REWARDS>','<SIGNAL_FRAGMENTS>','<TEAM_VESTING>']
     ).slice(2));
     // WadoozieTreasury:
     console.log('Treasury:', enc.encode(
       ['uint256','address[]','address[]','address'],
       [86400, [], ['0x0000000000000000000000000000000000000000'], '<DEPLOYER>']
     ).slice(2));
     // Headquarters:
     console.log('HQ:', enc.encode(
       ['address','address','uint48','uint32','uint256','uint256','uint48'],
       ['<TOKEN>','<TREASURY>',7200,50400,'1000000000000000000000',350,7200]
     ).slice(2));
   "
   ```

8. Click *Verify and Publish*.

---

## 8. Post-deploy checklist

- [ ] All three contracts show **green checkmark** on Etherscan
- [ ] `deployments-flat/mainnet.json` committed to a private repo or backed up offline
- [ ] Deployer hot wallet (if used) drained and rotated
- [ ] Deployer EOA confirmed to have **no remaining roles** on the treasury and **zero WADZ balance**
- [ ] All six immutable getters (`LP_WALLET`, `TREASURY`, `PUBLISHER_REWARDS`, `SIGNAL_FRAGMENTS`, `TEAM_VESTING`, `BURN_ADDRESS`) on the token return the intended addresses
- [ ] Per-wallet balances confirmed on Etherscan (see *Sanity-check* above)
- [ ] Token contract address announced only **after** verification passes
- [ ] Frontend (`dao-frontend-demo/lib/contracts.ts` if used) updated with mainnet addresses

---

## 9. Rollback / incidents

There is **no upgrade path**. The contracts are immutable, the timelock cannot be migrated (`updateTimelock` reverts), and there is no admin role left on the treasury.

If a bug is discovered post-deploy, the only mitigation is **deploy v2 and migrate via governance** — token holders vote to send funds out of the existing treasury into a new system. Plan accordingly.
