import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const VOTING_DELAY = 7200n;
const VOTING_PERIOD = 50400n;
const PROPOSAL_THRESHOLD = 1_000n * 10n ** 18n;
const QUORUM_NUMERATOR = 350n;
const VOTE_EXTENSION = 7200n;
const TIMELOCK_DELAY = 86400;

const WadoozieDAOModule = buildModule("WadoozieDAOModule", (m) => {
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

export default WadoozieDAOModule;
