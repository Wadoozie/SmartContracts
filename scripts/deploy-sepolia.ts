import { network } from "hardhat";

async function main() {
  const connection = await network.connect();
  const { ethers } = connection;

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  // Test parameters (fast)
  const VOTING_DELAY = 1n;
  const VOTING_PERIOD = 75n;
  const PROPOSAL_THRESHOLD = 1_000n * 10n ** 18n;
  const QUORUM_PERCENT = 4n;
  const TIMELOCK_DELAY = 600;

  // 1. Deploy Token
  console.log("Deploying Token...");
  const token = await ethers.deployContract("Wadoozie", [deployer.address]);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("Token:", tokenAddr);

  // 2. Deploy Timelock
  console.log("Deploying Timelock...");
  const timelock = await ethers.deployContract("WadoozieTimelock", [
    TIMELOCK_DELAY,
    [],
    ["0x0000000000000000000000000000000000000000"],
    deployer.address,
  ]);
  await timelock.waitForDeployment();
  const timelockAddr = await timelock.getAddress();
  console.log("Timelock:", timelockAddr);

  // 3. Deploy Governor
  console.log("Deploying Governor...");
  const governor = await ethers.deployContract("HeadQuarters", [
    tokenAddr,
    timelockAddr,
    VOTING_DELAY,
    VOTING_PERIOD,
    PROPOSAL_THRESHOLD,
    QUORUM_PERCENT,
    deployer.address, // proposal guardian
  ]);
  await governor.waitForDeployment();
  const govAddr = await governor.getAddress();
  console.log("Governor:", govAddr);

  // 4. Grant roles
  console.log("\nGranting roles...");
  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
  const DEFAULT_ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();

  const tx1 = await timelock.grantRole(PROPOSER_ROLE, govAddr);
  await tx1.wait();
  console.log("PROPOSER_ROLE granted");

  const tx2 = await timelock.grantRole(CANCELLER_ROLE, govAddr);
  await tx2.wait();
  console.log("CANCELLER_ROLE granted");

  const tx3 = await timelock.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);
  await tx3.wait();
  console.log("DEFAULT_ADMIN_ROLE renounced");

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("DEPLOYMENT COMPLETE");
  console.log("=".repeat(50));
  console.log("Token:    ", tokenAddr);
  console.log("Timelock: ", timelockAddr);
  console.log("Governor: ", govAddr);
  console.log("=".repeat(50));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
