import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// ── Recommended production parameters ──────────────────────────────────
const VOTING_DELAY = 7200n; // ~1 day in blocks
const VOTING_PERIOD = 50400n; // ~1 week in blocks
const PROPOSAL_THRESHOLD = 1_000n * 10n ** 18n; // 1,000 WADT required to propose
const QUORUM_PERCENT = 4n; // 4% of total supply
const TIMELOCK_DELAY = 86400; // 1 day in seconds

const WadoozieDAOModule = buildModule("WadoozieDAOModule", (m) => {
  const deployer = m.getAccount(0);
  const initialHolder = m.getParameter("initialHolder", deployer);
  const guardian = m.getParameter("guardian", deployer);

  // 1. Deploy Wadoozie — entire supply goes to initialHolder
  const token = m.contract("Wadoozie", [initialHolder]);

  // 2. Deploy TimelockController
  //    - minDelay: TIMELOCK_DELAY
  //    - proposers: [] (will grant to governor)
  //    - executors: [address(0)] (anyone can execute)
  //    - admin: deployer (temporary, revoked below)
  const timelock = m.contract("WadoozieTimelock", [
    TIMELOCK_DELAY,
    [],
    ["0x0000000000000000000000000000000000000000"],
    deployer,
  ]);

  // 3. Deploy HeadQuarters
  const governor = m.contract("HeadQuarters", [
    token,
    timelock,
    VOTING_DELAY,
    VOTING_PERIOD,
    PROPOSAL_THRESHOLD,
    QUORUM_PERCENT,
    guardian,
  ]);

  // 4. Grant PROPOSER_ROLE to Governor
  const PROPOSER_ROLE = m.staticCall(timelock, "PROPOSER_ROLE");
  m.call(timelock, "grantRole", [PROPOSER_ROLE, governor], {
    id: "grantProposerRole",
  });

  // 5. Grant CANCELLER_ROLE to Governor
  const CANCELLER_ROLE = m.staticCall(timelock, "CANCELLER_ROLE");
  m.call(timelock, "grantRole", [CANCELLER_ROLE, governor], {
    id: "grantCancellerRole",
  });

  // 6. Revoke DEFAULT_ADMIN_ROLE from deployer — no human admin remains
  const DEFAULT_ADMIN_ROLE = m.staticCall(timelock, "DEFAULT_ADMIN_ROLE");
  m.call(timelock, "renounceRole", [DEFAULT_ADMIN_ROLE, deployer], {
    id: "renounceAdminRole",
  });

  return { token, timelock, governor };
});

export default WadoozieDAOModule;
