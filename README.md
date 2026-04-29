# Wadoozie DAO — Smart Contracts

Fully on-chain governance system for the Wadoozie ecosystem. Token holders vote on proposals that control the DAO treasury and can modify governance parameters. No single entity retains admin privileges after deployment.

## Table of Contents

- [Contracts](#contracts)
- [Token Specification](#token-specification)
- [Governance Parameters](#governance-parameters)
- [Proposal Guardian](#proposal-guardian)
- [Governance Lifecycle](#governance-lifecycle)
- [Timelock Roles](#timelock-roles)
- [Tech Stack](#tech-stack)
- [Requirements](#requirements)
- [Installation](#installation)
- [Compile](#compile)
- [Testing](#testing)
- [Deployment](#deployment)
- [Deployment Checklist](#deployment-checklist)
- [Contract Verification](#contract-verification)
- [Security](#security)
- [License](#license)

---

## Contracts

| Contract | File | Purpose |
|---|---|---|
| **Wadoozie** | `contracts/Wadoozie.sol` | ERC-20 governance token with fixed supply, delegation, and gasless approvals |
| **Headquarters** | `contracts/Headquarters.sol` | OpenZeppelin Governor — proposal creation, voting, queueing, execution |
| **WadoozieTreasury** | `contracts/WadoozieTreasury.sol` | TimelockController wrapper — treasury, execution delay, role-based access |

---

## Token Specification

| Property | Value |
|---|---|
| **Name** | Wadoozie |
| **Symbol** | WADZ |
| **Total Supply** | 2,000,000,000 (`totalSupply()` is fixed at this value forever) |
| **Effective Supply** | 1,000,000,001 (after the genesis dead-address burn) |
| **Decimals** | 18 |
| **Standard** | ERC-20 |

**Extensions:**

| Extension | Purpose |
|---|---|
| ERC20Votes | On-chain voting power tracking with checkpoints and delegation |
| ERC20Permit (EIP-2612) | Gasless token approvals via off-chain signatures |

### Genesis Distribution

The constructor takes six wallet addresses and distributes the supply atomically — there are no admin functions, so this is the only allocation event the contract will ever see.

| Allocation | Amount | % of effective | Recipient |
|---|---|---|---|
| **Dead-address burn** | 999,999,999 | — | `0x000…dEaD` (`BURN_ADDRESS`) |
| **Liquidity Pool** | 750,000,001 | 75% (+ 1 token ceremony residue) | `LP_WALLET` |
| **Treasury** | 100,000,000 | 10% | `TREASURY` (multisig) |
| **Publisher Rewards** | 70,000,000 | 7% | `PUBLISHER_REWARDS` (multisig) |
| **Signal Fragments** | 50,000,000 | 5% | `SIGNAL_FRAGMENTS` (multisig) |
| **Team Vesting** | 30,000,000 | 3% | `TEAM_VESTING` (timelock) |

`totalSupply()` permanently equals **2,000,000,000**: the burn is implemented as a transfer to `0x…dEaD`, not an OpenZeppelin `_burn`, so supply does not decrease. The 999,999,999 burned tokens sit in `0x…dEaD` forever (no key controls that address). All five allocation addresses are exposed as immutable public getters (`LP_WALLET`, `TREASURY`, `PUBLISHER_REWARDS`, `SIGNAL_FRAGMENTS`, `TEAM_VESTING`).

After the constructor finishes, the deployer holds **zero** tokens and has no role. There is nothing to renounce.

**Immutability guarantees:**
- No `mint` function — supply is fixed at deployment
- No `burn` function — tokens cannot be destroyed post-genesis
- No `pause` function — transfers cannot be halted
- No `owner` / `Ownable` — no admin key exists

### Auto-Delegation (WAD-04)

To avoid governance stalling on un-delegated supply, Wadoozie auto self-delegates recipients the first time they receive tokens via a transfer — voting power activates on arrival without requiring a separate `delegate()` call. Because the genesis distribution flows through `_transfer`, **all five allocation wallets are auto-self-delegated at deployment**, with voting power equal to their allocation. The `0x…dEaD` burn address is also self-delegated; its 999,999,999 voting power is permanently inert because no key controls the address. Any delegation a holder has already set — to self or someone else — is never overridden by a later transfer.

---

## Governance Parameters

### Production (`ignition/modules/WadoozieDAO.ts`)

| Parameter | Value | Description |
|---|---|---|
| **Voting Delay** | 7,200 blocks (~1 day) | Time between proposal creation and vote start |
| **Voting Period** | 50,400 blocks (~1 week) | Duration the voting window stays open |
| **Proposal Threshold** | 1,000 tokens | Minimum delegated voting power to create a proposal |
| **Quorum** | 4% of total supply (40,000,000 tokens) | Minimum participation for a vote to be valid |
| **Timelock Delay** | 86,400 seconds (1 day) | Mandatory wait after a proposal is queued before execution |

### Testnet (`ignition/modules/WadoozieDAO_Test.ts`)

| Parameter | Value | Description |
|---|---|---|
| **Voting Delay** | 1 block (~12 seconds) | Near-instant for testing |
| **Voting Period** | 75 blocks (~15 minutes) | Short window for fast iteration |
| **Proposal Threshold** | 1,000 tokens | Same as production |
| **Quorum** | 4% | Same as production |
| **Timelock Delay** | 600 seconds (10 minutes) | Shortened for testing |

All governance parameters are modifiable through governance proposals via `GovernorSettings` (`setVotingDelay`, `setVotingPeriod`, `setProposalThreshold`, `updateQuorumNumerator`).

---

## Proposal Guardian

Headquarters includes the `GovernorProposalGuardian` extension — an emergency address that can cancel any non-executed proposal.

| Property | Detail |
|---|---|
| **Set at** | Constructor (`_guardian` parameter) |
| **Can do** | Cancel any proposal in Pending, Active, Succeeded, or Queued state |
| **Cannot do** | Create proposals, vote, execute, or change parameters |
| **Change/remove** | Only via governance proposal (`setProposalGuardian`) |
| **Remove entirely** | Pass `address(0)` to `setProposalGuardian` |

**Deadlock risk:** If the guardian is compromised, it can cancel the proposal attempting to replace it. Mitigation: always use a multisig wallet as guardian, never a single EOA.

---

## Governance Lifecycle

```
Propose  ──>  Voting Delay  ──>  Active Voting  ──>  Succeeded  ──>  Queue  ──>  Timelock Delay  ──>  Execute
                                                         │
                                                     Defeated
                                                     (quorum not met or majority Against)
```

| Step | Function | Who |
|---|---|---|
| 1. **Propose** | `propose(targets, values, calldatas, description)` | Any address with >= `proposalThreshold` delegated votes |
| 2. **Vote** | `castVote(proposalId, support)` | Any address with delegated voting power (0=Against, 1=For, 2=Abstain) |
| 3. **Queue** | `queue(targets, values, calldatas, descriptionHash)` | Anyone, if proposal succeeded |
| 4. **Execute** | `execute(targets, values, calldatas, descriptionHash)` | Anyone, after timelock delay has passed |
| **Cancel** | `cancel(targets, values, calldatas, descriptionHash)` | Proposer (if Pending) or Proposal Guardian |

---

## Timelock Roles

After deployment and role configuration, the Timelock access control is:

| Role | Assigned To | Purpose |
|---|---|---|
| `PROPOSER_ROLE` | Headquarters (Governor) | Queue approved proposals |
| `CANCELLER_ROLE` | Headquarters (Governor) | Cancel queued proposals |
| `EXECUTOR_ROLE` | `address(0)` (anyone) | Execute proposals after delay |
| `DEFAULT_ADMIN_ROLE` | Renounced (nobody) | No human can grant or revoke roles |

The Timelock holds all DAO funds and is the contract that executes on-chain actions.

---

## Tech Stack

| Component | Version |
|---|---|
| Solidity | ^0.8.28 |
| OpenZeppelin Contracts | 5.6.1 |
| Hardhat | 3.0 |
| Ethers.js | 6.x |
| TypeScript | 5.x |
| Node.js | >= 18 |

---

## Requirements

- **Node.js** >= 18
- **npm** >= 9
- A `.env` file based on `.env.example`:

```env
DEPLOYER_PRIVATE_KEY=your_private_key_here
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
ETHERSCAN_API_KEY=your_etherscan_api_key
```

---

## Installation

```bash
git clone https://github.com/wadoozie/SmartContracts.git
cd SmartContracts
npm install
```

---

## Compile

```bash
npm run compile
```

Artifacts are written to `artifacts/` (gitignored).

---

## Testing

```bash
npm test
```

**79 tests** across three suites:

| Suite | File | Coverage |
|---|---|---|
| **WadoozieToken** | `test/Wadoozie.test.ts` | Deployment, genesis distribution, constructor reverts, transfers, permit, votes, auto-delegation, immutability |
| **Headquarters** | `test/Headquarters.test.ts` | Configuration, proposal creation, voting, proposal guardian, proposal states |
| **GovernanceLifecycle** | `test/GovernanceLifecycle.test.ts` | Full propose-vote-queue-execute flow, timelock enforcement, cancellation, access control, ETH handling, self-modification |

---

## Deployment

### Deployment Order

Contracts must be deployed in this order due to constructor dependencies:

```
1. Wadoozie Token
2. WadoozieTreasury
3. Headquarters (requires token + timelock addresses)
4. Grant PROPOSER_ROLE to Headquarters on Timelock
5. Grant CANCELLER_ROLE to Headquarters on Timelock
6. Renounce DEFAULT_ADMIN_ROLE on Timelock
```

The Ignition modules handle all six steps automatically.

### Ethereum Mainnet

```bash
npm run deploy:mainnet
```

Deploys all three contracts with production parameters, grants roles, and renounces admin — fully automated via Hardhat Ignition.

### Local Network

```bash
# Terminal 1 — start a local Hardhat node
npx hardhat node

# Terminal 2 — deploy with production parameters
npm run deploy:local
```

### Sepolia Testnet

```bash
# Production parameters
npm run deploy:sepolia

# Fast test parameters
npm run deploy:sepolia:test
```

### Available npm Scripts

| Script | Description |
|---|---|
| `npm run compile` | Compile all contracts |
| `npm test` | Run the full test suite |
| `npm run deploy:mainnet` | Ignition deploy to Ethereum mainnet |
| `npm run deploy:local` | Ignition deploy to localhost (production params) |
| `npm run deploy:local:test` | Ignition deploy to localhost (test params) |
| `npm run deploy:sepolia` | Ignition deploy to Sepolia (production params) |
| `npm run deploy:sepolia:test` | Ignition deploy to Sepolia (test params) |

---

## Deployment Checklist

Before deploying to Ethereum mainnet:

1. **Run all tests** and confirm 79/79 pass:
   ```bash
   npm test
   ```

2. **Configure `.env`** with mainnet RPC URL, deployer private key, and Etherscan API key.

3. **Set the six wallet addresses** for the genesis distribution. Each must be the *final* holder of its allocation — there is no admin to change them later. Use multisigs for everything except the LP wallet (which will pair with ETH on Uniswap immediately post-deploy).

   | Constructor parameter | Allocation | Recommended type |
   |---|---|---|
   | `deployer_` | 0 (drains during constructor) | The signer running the deploy tx |
   | `lpWallet_` | 750,000,001 WADZ | EOA or multisig that will pair LP on Uniswap |
   | `treasury_` | 100,000,000 WADZ | DAO treasury multisig |
   | `publisherRewards_` | 70,000,000 WADZ | Publisher payouts multisig |
   | `signalFragments_` | 50,000,000 WADZ | Signal Fragments prize-pool multisig |
   | `teamVesting_` | 30,000,000 WADZ | Team vesting timelock contract |

5. **Deploy:**
   ```bash
   npm run deploy:mainnet
   ```

6. **Verify contracts** on Etherscan (see below).

7. **Confirm roles** on Etherscan:
   - Timelock `hasRole(PROPOSER_ROLE, governorAddress)` returns `true`
   - Timelock `hasRole(CANCELLER_ROLE, governorAddress)` returns `true`
   - Timelock `hasRole(DEFAULT_ADMIN_ROLE, deployerAddress)` returns `false`

8. **Delegation** — all five genesis allocation wallets are auto-self-delegated by the constructor (their voting power is live the moment the deploy tx confirms). No manual `delegate()` calls are required to activate quorum. Downstream recipients (anyone who later receives WADZ via transfer) are also auto-self-delegated on first receipt; see the *Auto-Delegation (WAD-04)* section for details.

---

## Contract Verification

After deployment, verify source code on Etherscan:

```bash
# Token
npx hardhat verify --network mainnet <TOKEN_ADDRESS> \
  "<DEPLOYER_ADDRESS>" \
  "<LP_WALLET_ADDRESS>" \
  "<TREASURY_ADDRESS>" \
  "<PUBLISHER_REWARDS_ADDRESS>" \
  "<SIGNAL_FRAGMENTS_ADDRESS>" \
  "<TEAM_VESTING_ADDRESS>"

# Timelock
npx hardhat verify --network mainnet <TIMELOCK_ADDRESS> \
  86400 "[]" '["0x0000000000000000000000000000000000000000"]' "<DEPLOYER_ADDRESS>"

# Governor
npx hardhat verify --network mainnet <GOVERNOR_ADDRESS> \
  "<TOKEN_ADDRESS>" "<TIMELOCK_ADDRESS>" 7200 50400 "1000000000000000000000" 4 "<GUARDIAN_ADDRESS>"
```

Or use the convenience script (requires `ETHERSCAN_API_KEY` in environment):

```bash
export ETHERSCAN_API_KEY=your_key_here
bash scripts/verify-etherscan.sh
```

---

## Security

### Design Principles

- **Immutable token** — no mint, burn, pause, or admin functions
- **No admin keys** — `DEFAULT_ADMIN_ROLE` is renounced after setup
- **Timelock protection** — mandatory delay before any governance action executes
- **Proposal guardian** — emergency cancellation via multisig
- **Battle-tested dependencies** — built entirely on OpenZeppelin's audited contract library
- **No upgradeability** — contracts cannot be changed after deployment

### Inheritance

```
Wadoozie
├── ERC20
├── ERC20Permit
└── ERC20Votes

Headquarters
├── Governor
├── GovernorSettings
├── GovernorCountingSimple
├── GovernorVotes
├── GovernorVotesQuorumFraction
├── GovernorTimelockControl
└── GovernorProposalGuardian

WadoozieTreasury
└── TimelockController
```

### Known Considerations

| Issue | Mitigation |
|---|---|
| Guardian deadlock — compromised guardian cancels its own replacement proposal | Use a multisig as guardian, never a single wallet |
| Voter apathy — quorum not reached | Recipients are auto self-delegated on first transfer (WAD-04 mitigation), so most circulating supply contributes to quorum without manual opt-in. Quorum is also intentionally low (4%) and adjustable via governance. |
| Flash loan attacks on voting | ERC20Votes uses checkpoints at proposal snapshot block, not current balance |
| Timelock bypass | Not possible — `GovernorTimelockControl` enforces queueing for all proposals |

---

## License

[MIT](LICENSE)
