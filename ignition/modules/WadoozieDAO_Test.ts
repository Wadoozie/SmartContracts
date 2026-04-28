import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const VOTING_DELAY = 1n;
const VOTING_PERIOD = 75n;
const PROPOSAL_THRESHOLD = 1_000n * 10n ** 18n;
const QUORUM_NUMERATOR = 350n;
const VOTE_EXTENSION = 25n;
const TIMELOCK_DELAY = 600;

const WadoozieDAOTestModule = buildModule("WadoozieDAOTestModule", (m) => {
  const deployer = m.getAccount(0);
  const initialHolder = m.getParameter("initialHolder", deployer);

  const token = m.contract("Wadoozie", [initialHolder]);

  const timelock = m.contract("WadoozieTreasury", [
    TIMELOCK_DELAY,
    [],
    ["0x0000000000000000000000000000000000000000"],
    deployer,
  ]);

  const governor = m.contract("Headquarters", [
    token,
    timelock,
    VOTING_DELAY,
    VOTING_PERIOD,
    PROPOSAL_THRESHOLD,
    QUORUM_NUMERATOR,
    VOTE_EXTENSION,
  ]);

  const PROPOSER_ROLE = m.staticCall(timelock, "PROPOSER_ROLE");
  m.call(timelock, "grantRole", [PROPOSER_ROLE, governor], {
    id: "grantProposerRole",
  });

  const CANCELLER_ROLE = m.staticCall(timelock, "CANCELLER_ROLE");
  m.call(timelock, "grantRole", [CANCELLER_ROLE, governor], {
    id: "grantCancellerRole",
  });

  const DEFAULT_ADMIN_ROLE = m.staticCall(timelock, "DEFAULT_ADMIN_ROLE");
  m.call(timelock, "renounceRole", [DEFAULT_ADMIN_ROLE, deployer], {
    id: "renounceAdminRole",
  });

  return { token, timelock, governor };
});

export default WadoozieDAOTestModule;
