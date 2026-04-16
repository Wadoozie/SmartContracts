import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// ── FAST TEST PARAMETERS ─────────────────────────────────────────────
// Perfect for rapid testing of the full governance flow
const VOTING_DELAY = 1n;        // 1 block (~12 seconds on Sepolia)
const VOTING_PERIOD = 75n;      // 75 blocks (~15 minutes at 12 sec/block)
const PROPOSAL_THRESHOLD = 1_000n * 10n ** 18n; // 1,000 WADZ required to propose
const QUORUM_PERCENT = 4n;       // 4% of total supply
const TIMELOCK_DELAY = 600;      // 10 minutes in seconds

const WadoozieDAOTestModule = buildModule("WadoozieDAOTestModule", (m) => {
  const deployer = m.getAccount(0);
  const initialHolder = m.getParameter("initialHolder", deployer);

  // 1. Deploy Wadoozie — entire supply goes to initialHolder
  const token = m.contract("Wadoozie", [initialHolder]);

  // 2. Deploy TimelockController (ThePitStop - The Treasury)
  //    - minDelay: 600 seconds (10 minutes for testing)
  //    - proposers: [] (will grant to governor)
  //    - executors: [address(0)] (anyone can execute)
  //    - admin: deployer (temporary, revoked below)
  const timelock = m.contract("WadoozieTimelock", [
    TIMELOCK_DELAY,
    [],
    ["0x0000000000000000000000000000000000000000"],
    deployer,
  ]);

  // 3. Deploy Headquarters (Governor)
  const governor = m.contract("Headquarters", [
    token,
    timelock,
    VOTING_DELAY,
    VOTING_PERIOD,
    PROPOSAL_THRESHOLD,
    QUORUM_PERCENT,
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

export default WadoozieDAOTestModule;
