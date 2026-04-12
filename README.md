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
- [Mainnet Checklist](#mainnet-checklist)
- [Contract Verification](#contract-verification)
- [Security](#security)
- [License](#license)

---

## Contracts

| Contract | File | Purpose |
|---|---|---|
| **Wadoozie** | `contracts/Wadoozie.sol` | ERC-20 governance token with fixed supply, delegation, and gasless approvals |
| **HeadQuarters** | `contracts/HeadQuarters.sol` | OpenZeppelin Governor — proposal creation, voting, queueing, execution |
| **WadoozieTimelock** | `contracts/WadoozieTimelock.sol` | TimelockController wrapper — treasury, execution delay, role-based access |

---

## Token Specification

| Property | Testnet | Mainnet |
|---|---|---|
| **Name** | WadTest | Wadoozie |
| **Symbol** | WADT | WADZ |
| **Total Supply** | 1,000,000,000 | 1,000,000,000 |
| **Decimals** | 18 | 18 |
| **Standard** | ERC-20 | ERC-20 |

**Extensions:**

| Extension | Purpose |
|---|---|
| ERC20Votes | On-chain voting power tracking with checkpoints and delegation |
| ERC20Permit (EIP-2612) | Gasless token approvals via off-chain signatures |

**Immutability guarantees:**
- No `mint` function — supply is fixed at deployment
- No `burn` function — tokens cannot be destroyed
- No `pause` function — transfers cannot be halted
- No `owner` / `Ownable` — no admin key exists

The entire supply is minted to `initialHolder` in the constructor. Voting power is inactive until a holder calls `delegate()`.

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

HeadQuarters includes the `GovernorProposalGuardian` extension — an emergency address that can cancel any non-executed proposal.

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
| `PROPOSER_ROLE` | HeadQuarters (Governor) | Queue approved proposals |
| `CANCELLER_ROLE` | HeadQuarters (Governor) | Cancel queued proposals |
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
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
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

**60 tests** across three suites:

| Suite | File | Coverage |
|---|---|---|
| **WadoozieToken** | `test/Wadoozie.test.ts` | Deployment, transfers, permit, votes, immutability |
| **HeadQuarters** | `test/HeadQuarters.test.ts` | Configuration, proposal creation, voting, proposal guardian, proposal states |
| **GovernanceLifecycle** | `test/GovernanceLifecycle.test.ts` | Full propose-vote-queue-execute flow, timelock enforcement, cancellation, access control, ETH handling, self-modification |

---

## Deployment

### Deployment Order

Contracts must be deployed in this order due to constructor dependencies:

```
1. Wadoozie Token
2. WadoozieTimelock
3. HeadQuarters (requires token + timelock addresses)
4. Grant PROPOSER_ROLE to HeadQuarters on Timelock
5. Grant CANCELLER_ROLE to HeadQuarters on Timelock
6. Renounce DEFAULT_ADMIN_ROLE on Timelock
```

The Ignition modules handle all six steps automatically.

### Local Network

```bash
# Terminal 1 — start a local Hardhat node
npx hardhat node

# Terminal 2 — deploy with production parameters
npm run deploy:local

# Or deploy with fast test parameters
npm run deploy:local:test
```

### Sepolia Testnet

```bash
# Production parameters
npm run deploy:sepolia

# Fast test parameters (recommended for first deploy)
npm run deploy:sepolia:test
```

### Standalone Script (Alternative)

```bash
npm run deploy:script
```

Runs `scripts/deploy-test.ts` which deploys all three contracts, configures roles, and prints a summary with addresses.

### Available npm Scripts

| Script | Description |
|---|---|
| `npm run compile` | Compile all contracts |
| `npm test` | Run the full test suite |
| `npm run deploy:local` | Ignition deploy to localhost (production params) |
| `npm run deploy:local:test` | Ignition deploy to localhost (test params) |
| `npm run deploy:sepolia` | Ignition deploy to Sepolia (production params) |
| `npm run deploy:sepolia:test` | Ignition deploy to Sepolia (test params) |
| `npm run deploy:script` | Standalone deploy script to Sepolia |

---

## Mainnet Checklist

Before deploying to mainnet:

1. **Update token branding** in `contracts/Wadoozie.sol`:
   ```solidity
   // Change from:
   constructor(address initialHolder) ERC20("WadTest", "WADT") ERC20Permit("WadTest")

   // Change to:
   constructor(address initialHolder) ERC20("Wadoozie", "WADZ") ERC20Permit("Wadoozie")
   ```

2. **Update test helpers** in `test/helpers.ts`:
   ```typescript
   TOKEN_NAME: "Wadoozie",
   TOKEN_SYMBOL: "WADZ",
   ```

3. **Run all tests** and confirm 60/60 pass:
   ```bash
   npm test
   ```

4. **Set `initialHolder`** to the address that should receive the full supply (use a multisig).

5. **Set `guardian`** to a multisig address (never a single EOA).

6. **Add mainnet network** to `hardhat.config.ts`:
   ```typescript
   mainnet: {
     type: "http" as const,
     url: process.env.ETHEREUM_RPC_URL || "",
     accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
   },
   ```

7. **Deploy:**
   ```bash
   npx hardhat ignition deploy ignition/modules/WadoozieDAO.ts --network mainnet
   ```

8. **Verify contracts** on Etherscan (see below).

9. **Confirm roles** on Etherscan:
   - Timelock `hasRole(PROPOSER_ROLE, governorAddress)` returns `true`
   - Timelock `hasRole(CANCELLER_ROLE, governorAddress)` returns `true`
   - Timelock `hasRole(DEFAULT_ADMIN_ROLE, deployerAddress)` returns `false`

10. **Delegate tokens** — the `initialHolder` must call `delegate(ownAddress)` to activate voting power before any proposals can pass quorum.

---

## Contract Verification

After deployment, verify source code on Etherscan:

```bash
# Token
npx hardhat verify --network <network> <TOKEN_ADDRESS> "<INITIAL_HOLDER_ADDRESS>"

# Timelock
npx hardhat verify --network <network> <TIMELOCK_ADDRESS> \
  86400 "[]" '["0x0000000000000000000000000000000000000000"]' "<DEPLOYER_ADDRESS>"

# Governor
npx hardhat verify --network <network> <GOVERNOR_ADDRESS> \
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

HeadQuarters
├── Governor
├── GovernorSettings
├── GovernorCountingSimple
├── GovernorVotes
├── GovernorVotesQuorumFraction
├── GovernorTimelockControl
└── GovernorProposalGuardian

WadoozieTimelock
└── TimelockController
```

### Known Considerations

| Issue | Mitigation |
|---|---|
| Guardian deadlock — compromised guardian cancels its own replacement proposal | Use a multisig as guardian, never a single wallet |
| Voter apathy — quorum not reached | 4% quorum is intentionally low; adjustable via governance |
| Flash loan attacks on voting | ERC20Votes uses checkpoints at proposal snapshot block, not current balance |
| Timelock bypass | Not possible — `GovernorTimelockControl` enforces queueing for all proposals |

---

## License

[MIT](LICENSE)
