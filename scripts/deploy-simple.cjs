// Simple deployment script using JavaScript (avoids TypeScript import issues)
const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying Wadoozie DAO (Fast Test Parameters)...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH\n");

  // Fast test parameters
  const VOTING_DELAY = 1n;        // 1 block (~12 seconds)
  const VOTING_PERIOD = 75n;      // 75 blocks (~15 minutes)
  const PROPOSAL_THRESHOLD = 0n;
  const QUORUM_NUMERATOR = 350n;  // 3.5% of supply (numerator over 10000)
  const TIMELOCK_DELAY = 600;     // 10 minutes

  // 1. Deploy Token
  console.log("📝 Deploying Wadoozie Token...");
  const Wadoozie = await hre.ethers.getContractFactory("Wadoozie");
  const token = await Wadoozie.deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("✅ Token:", tokenAddress);

  // 2. Deploy Timelock
  console.log("\n🏦 Deploying WadoozieTreasury (ThePitStop)...");
  const Timelock = await hre.ethers.getContractFactory("WadoozieTreasury");
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
  console.log("\n🏛️  Deploying Headquarters (Governor)...");
  const Governor = await hre.ethers.getContractFactory("Headquarters");
  const governor = await Governor.deploy(
    tokenAddress,
    timelockAddress,
    VOTING_DELAY,
    VOTING_PERIOD,
    PROPOSAL_THRESHOLD,
    QUORUM_NUMERATOR,
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
  await (await timelock.grantRole(PROPOSER_ROLE, governorAddress)).wait();

  console.log("  - Granting CANCELLER_ROLE...");
  await (await timelock.grantRole(CANCELLER_ROLE, governorAddress)).wait();

  console.log("  - Renouncing admin role...");
  await (await timelock.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait();

  console.log("✅ Setup complete\n");

  // Summary
  console.log("=".repeat(60));
  console.log("🎉 DEPLOYMENT SUCCESSFUL!");
  console.log("=".repeat(60));
  console.log("\n📋 Contract Addresses:");
  console.log("   Wadoozie (Token):        ", tokenAddress);
  console.log("   WadoozieTreasury:        ", timelockAddress);
  console.log("   Headquarters (Governor): ", governorAddress);
  console.log("\n⚡ Parameters:");
  console.log("   Voting Delay:    1 block (~12 seconds)");
  console.log("   Voting Period:   75 blocks (~15 minutes)");
  console.log("   Timelock Delay:  600 seconds (10 minutes)");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
