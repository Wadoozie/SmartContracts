import { artifacts, network } from "hardhat";
import fs from "fs";
import path from "path";

// ── Test DAO parameters (small values for fast tests) ──────────────────
export const TEST_PARAMS = {
  TOKEN_NAME: "WadTest",
  TOKEN_SYMBOL: "WADT",
  TOTAL_SUPPLY: 1_000_000_000n * 10n ** 18n, // 1B tokens
  VOTING_DELAY: 10n, // blocks
  VOTING_PERIOD: 50n, // blocks
  PROPOSAL_THRESHOLD: 1_000n * 10n ** 18n, // 1,000 tokens required to propose
  QUORUM_PERCENT: 4n,
  TIMELOCK_DELAY: 60, // seconds
};

// ── Governance vote values (GovernorCountingSimple) ────────────────────
export const VoteType = {
  Against: 0n,
  For: 1n,
  Abstain: 2n,
} as const;

// ── Proposal states (Governor.ProposalState enum) ──────────────────────
export const ProposalState = {
  Pending: 0n,
  Active: 1n,
  Canceled: 2n,
  Defeated: 3n,
  Succeeded: 4n,
  Queued: 5n,
  Expired: 6n,
  Executed: 7n,
} as const;

// ── Helper: get TimelockController factory from build info ─────────────
// Hardhat 3 only generates artifacts for project contracts, not dependencies.
// We extract the ABI+bytecode from the Solidity compiler build output.
async function getTimelockFactory(ethers: any, signer: any) {
  const buildInfoIds = await artifacts.getAllBuildInfoIds();
  for (const id of buildInfoIds) {
    const outputPath = await artifacts.getBuildInfoOutputPath(id);
    if (!outputPath) continue;
    const data = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    const contracts = data.output?.contracts ?? data.contracts;
    if (!contracts) continue;
    for (const [sourceName, sourceContracts] of Object.entries(
      contracts as Record<string, any>,
    )) {
      if (sourceName.includes("TimelockController")) {
        const tc = sourceContracts["TimelockController"];
        if (tc) {
          return ethers.getContractFactory(
            tc.abi,
            "0x" + tc.evm.bytecode.object,
            signer,
          );
        }
      }
    }
  }
  throw new Error("TimelockController not found in build info");
}

// ── Deploy fixture ─────────────────────────────────────────────────────
export async function deployDAOFixture(connection: any) {
  const { ethers } = connection;
  const [deployer, initialHolder, voter1, voter2, voter3] =
    await ethers.getSigners();

  // 1. Deploy Wadoozie
  const token = await ethers.deployContract("Wadoozie", [
    initialHolder.address,
  ]);

  // 2. Deploy TimelockController (from build info, not artifact)
  const timelockFactory = await getTimelockFactory(ethers, deployer);
  const timelock = await timelockFactory.deploy(
    TEST_PARAMS.TIMELOCK_DELAY,
    [], // proposers — empty, will grant to governor
    [ethers.ZeroAddress], // executors — anyone
    deployer.address, // admin — temporary
  );

  // 3. Deploy HeadQuarters
  const governor = await ethers.deployContract("HeadQuarters", [
    await token.getAddress(),
    await timelock.getAddress(),
    TEST_PARAMS.VOTING_DELAY,
    TEST_PARAMS.VOTING_PERIOD,
    TEST_PARAMS.PROPOSAL_THRESHOLD,
    TEST_PARAMS.QUORUM_PERCENT,
    deployer.address,
  ]);

  const governorAddress = await governor.getAddress();

  // 4. Grant PROPOSER_ROLE to Governor
  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  await timelock.grantRole(PROPOSER_ROLE, governorAddress);

  // 5. Grant CANCELLER_ROLE to Governor
  const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
  await timelock.grantRole(CANCELLER_ROLE, governorAddress);

  // 6. Revoke DEFAULT_ADMIN_ROLE from deployer
  const DEFAULT_ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();
  await timelock.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);

  return {
    token,
    timelock,
    governor,
    deployer,
    initialHolder,
    voter1,
    voter2,
    voter3,
  };
}

// ── Helper: delegate + mine past voting delay ──────────────────────────
export async function delegateAndMine(
  token: any,
  delegator: any,
  delegatee: any,
  networkHelpers: any,
) {
  await token.connect(delegator).delegate(delegatee.address);
  await networkHelpers.mine(1);
}

// ── Helper: create proposal and return proposalId ──────────────────────
export async function propose(
  governor: any,
  proposer: any,
  targets: string[],
  values: bigint[],
  calldatas: string[],
  description: string,
) {
  const tx = await governor
    .connect(proposer)
    .propose(targets, values, calldatas, description);
  const receipt = await tx.wait();

  // Extract ProposalCreated event to get proposalId
  const event = receipt.logs.find(
    (log: any) => log.fragment?.name === "ProposalCreated",
  );
  const proposalId = event.args[0];
  return { proposalId, tx, receipt };
}
