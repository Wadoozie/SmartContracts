// ES Module deployment script
import hre from "hardhat";
import "@nomicfoundation/hardhat-ethers";

async function main() {
  console.log("🚀 Deploying Wadoozie DAO (Fast Test Parameters)...\n");

  const ethers = hre.ethers;
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH\n");

  // Fast test parameters
  const VOTING_DELAY = 1n;
  const VOTING_PERIOD = 75n;
  const PROPOSAL_THRESHOLD = 0n;
  const QUORUM_PERCENT = 4n;
  const TIMELOCK_DELAY = 600;

  // 1. Deploy Token
  console.log("📝 Deploying Wadoozie Token...");
  const Wadoozie = await ethers.getContractFactory("Wadoozie");
  const token = await Wadoozie.deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("✅ Token:", tokenAddress);

  // 2. Deploy Timelock
  console.log("\n🏦 Deploying WadoozieTimelock...");
  const Timelock = await ethers.getContractFactory("WadoozieTimelock");
  const timelock = await Timelock.deploy(
    TIMELOCK_DELAY,
    [],
    ["0x0000000000000000000000000000000000000000"],
    deployer.address
  );
  await timelock.waitForDeployment();
  const timelockAddress = await timelock.getAddress();
  console.log("✅ Timelock:", timelockAddress);

  // 3. Deploy Governor
  console.log("\n🏛️  Deploying HeadQuarters...");
  const Governor = await ethers.getContractFactory("HeadQuarters");
  const governor = await Governor.deploy(
    tokenAddress,
    timelockAddress,
    VOTING_DELAY,
    VOTING_PERIOD,
    PROPOSAL_THRESHOLD,
    QUORUM_PERCENT,
    deployer.address // proposal guardian
  );
  await governor.waitForDeployment();
  const governorAddress = await governor.getAddress();
  console.log("✅ Governor:", governorAddress);

  // 4. Setup roles
  console.log("\n🔐 Setting up roles...");
  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
  const DEFAULT_ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();

  console.log("  - Granting PROPOSER_ROLE...");
  const tx1 = await timelock.grantRole(PROPOSER_ROLE, governorAddress);
  await tx1.wait();

  console.log("  - Granting CANCELLER_ROLE...");
  const tx2 = await timelock.grantRole(CANCELLER_ROLE, governorAddress);
  await tx2.wait();

  console.log("  - Renouncing admin role...");
  const tx3 = await timelock.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);
  await tx3.wait();

  console.log("✅ Setup complete\n");

  console.log("=".repeat(60));
  console.log("🎉 DEPLOYMENT SUCCESSFUL!");
  console.log("=".repeat(60));
  console.log("\n📋 COPY THESE ADDRESSES:");
  console.log("   token:     \"" + tokenAddress + "\",");
  console.log("   governor:  \"" + governorAddress + "\",");
  console.log("   timelock:  \"" + timelockAddress + "\",");
  console.log("\n⚡ Parameters:");
  console.log("   Voting Delay:    1 block (~12 sec)");
  console.log("   Voting Period:   75 blocks (~15 min)");
  console.log("   Timelock Delay:  10 minutes");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
