import solc from "solc";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { network } from "hardhat";
import "dotenv/config";

const VOTING_DELAY = 7200n;
const VOTING_PERIOD = 50400n;
const PROPOSAL_THRESHOLD = 1_000n * 10n ** 18n;
const QUORUM_NUMERATOR = 350n;
const VOTE_EXTENSION = 7200n;
const TIMELOCK_DELAY = 86400;

function compileFlat(name) {
  const source = readFileSync(`contracts-flat/${name}.sol`, "utf8");
  const input = {
    language: "Solidity",
    sources: { [`${name}.sol`]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const fatal = (out.errors || []).filter((e) => e.severity === "error");
  if (fatal.length) {
    for (const e of fatal) console.error(e.formattedMessage || e.message);
    throw new Error(`Compilation failed for ${name}`);
  }
  const c = out.contracts[`${name}.sol`][name];
  return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
}

async function main() {
  if (!existsSync("contracts-flat/Wadoozie.sol")) {
    throw new Error("contracts-flat/ is empty. Run `node scripts/flatten.mjs` first.");
  }

  const conn = await network.connect();
  const { ethers } = conn;
  const [deployer] = await ethers.getSigners();

  const networkName = conn.networkName ?? "unknown";
  console.log(`Network:   ${networkName}`);
  console.log(`Deployer:  ${deployer.address}`);
  console.log(
    `Balance:   ${ethers.formatEther(
      await ethers.provider.getBalance(deployer.address),
    )} ETH\n`,
  );

  const initialHolder = process.env.INITIAL_HOLDER || deployer.address;

  console.log("[1/3] Compiling + deploying Wadoozie (flat)...");
  const w = compileFlat("Wadoozie");
  const Wadoozie = new ethers.ContractFactory(w.abi, w.bytecode, deployer);
  const token = await Wadoozie.deploy(initialHolder);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`        → ${tokenAddr}`);

  console.log("\n[2/3] Compiling + deploying WadoozieTreasury (flat)...");
  const t = compileFlat("WadoozieTreasury");
  const Treasury = new ethers.ContractFactory(t.abi, t.bytecode, deployer);
  const treasury = await Treasury.deploy(
    TIMELOCK_DELAY,
    [],
    [ethers.ZeroAddress],
    deployer.address,
  );
  await treasury.waitForDeployment();
  const treasuryAddr = await treasury.getAddress();
  console.log(`        → ${treasuryAddr}`);

  console.log("\n[3/3] Compiling + deploying Headquarters (flat)...");
  const h = compileFlat("Headquarters");
  const Headquarters = new ethers.ContractFactory(h.abi, h.bytecode, deployer);
  const governor = await Headquarters.deploy(
    tokenAddr,
    treasuryAddr,
    VOTING_DELAY,
    VOTING_PERIOD,
    PROPOSAL_THRESHOLD,
    QUORUM_NUMERATOR,
    VOTE_EXTENSION,
  );
  await governor.waitForDeployment();
  const governorAddr = await governor.getAddress();
  console.log(`        → ${governorAddr}`);

  console.log("\nConfiguring roles...");
  const PROPOSER_ROLE = await treasury.PROPOSER_ROLE();
  const CANCELLER_ROLE = await treasury.CANCELLER_ROLE();
  const DEFAULT_ADMIN_ROLE = await treasury.DEFAULT_ADMIN_ROLE();
  await (await treasury.grantRole(PROPOSER_ROLE, governorAddr)).wait();
  console.log("  PROPOSER_ROLE  → Headquarters");
  await (await treasury.grantRole(CANCELLER_ROLE, governorAddr)).wait();
  console.log("  CANCELLER_ROLE → Headquarters");
  await (
    await treasury.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address)
  ).wait();
  console.log("  DEFAULT_ADMIN_ROLE renounced by deployer");

  const record = {
    network: networkName,
    deployer: deployer.address,
    initialHolder,
    contracts: {
      Wadoozie: tokenAddr,
      WadoozieTreasury: treasuryAddr,
      Headquarters: governorAddr,
    },
    params: {
      votingDelay: VOTING_DELAY.toString(),
      votingPeriod: VOTING_PERIOD.toString(),
      proposalThreshold: PROPOSAL_THRESHOLD.toString(),
      quorumNumerator: QUORUM_NUMERATOR.toString(),
      quorumDenominator: "10000",
      voteExtension: VOTE_EXTENSION.toString(),
      timelockDelay: TIMELOCK_DELAY,
    },
    timestamp: new Date().toISOString(),
  };
  mkdirSync("deployments-flat", { recursive: true });
  const outPath = `deployments-flat/${networkName}.json`;
  writeFileSync(outPath, JSON.stringify(record, null, 2));

  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`Wadoozie         ${tokenAddr}`);
  console.log(`WadoozieTreasury ${treasuryAddr}`);
  console.log(`Headquarters     ${governorAddr}`);
  console.log(`\nSaved → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
