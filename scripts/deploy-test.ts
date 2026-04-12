import hre from "hardhat";
const ethers = (hre as any).ethers;

async function main() {
  console.log("🚀 Deploying Wadoozie DAO (Test Parameters)...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  // Test parameters
  const VOTING_DELAY = 1n;        // 1 block (~12 seconds)
  const VOTING_PERIOD = 75n;      // 75 blocks (~15 minutes)
  const PROPOSAL_THRESHOLD = 1_000n * 10n ** 18n; // 1,000 WADT
  const QUORUM_PERCENT = 4n;      // 4% of supply
  const TIMELOCK_DELAY = 600;     // 10 minutes

  // 1. Deploy Token
  console.log("📝 Deploying Wadoozie Token...");
  const Wadoozie = await ethers.getContractFactory("Wadoozie");
  const token = await Wadoozie.deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("✅ Wadoozie deployed to:", tokenAddress);

  // 2. Deploy Timelock
  console.log("\n🏦 Deploying WadoozieTimelock (ThePitStop - Treasury)...");
  const Timelock = await ethers.getContractFactory("WadoozieTimelock");
  const timelock = await Timelock.deploy(
    TIMELOCK_DELAY,
    [],
    ["0x0000000000000000000000000000000000000000"],
    deployer.address
  );
  await timelock.waitForDeployment();
  const timelockAddress = await timelock.getAddress();
  console.log("✅ Timelock deployed to:", timelockAddress);

  // 3. Deploy Governor
  console.log("\n🏛️  Deploying HeadQuarters (Governor)...");
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
  console.log("✅ Governor deployed to:", governorAddress);

  // 4. Grant roles
  console.log("\n🔐 Setting up roles...");
  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
  const DEFAULT_ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();

  console.log("  - Granting PROPOSER_ROLE to Governor...");
  await (await timelock.grantRole(PROPOSER_ROLE, governorAddress)).wait();

  console.log("  - Granting CANCELLER_ROLE to Governor...");
  await (await timelock.grantRole(CANCELLER_ROLE, governorAddress)).wait();

  console.log("  - Renouncing admin role...");
  await (await timelock.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait();

  console.log("✅ Roles configured\n");

  // Summary
  console.log("=" .repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  console.log("\n📋 Contract Addresses:");
  console.log("   Wadoozie (Token):        ", tokenAddress);
  console.log("   WadoozieTimelock:        ", timelockAddress);
  console.log("   HeadQuarters (Governor): ", governorAddress);
  console.log("\n⚡ Test Parameters:");
  console.log("   Voting Delay:    1 block (~12 seconds)");
  console.log("   Voting Period:   75 blocks (~15 minutes)");
  console.log("   Timelock Delay:  600 seconds (10 minutes)");
  console.log("   Total Flow:      ~26 minutes from proposal to execution");
  console.log("\n💡 Next Steps:");
  console.log("   1. Update dao-frontend-demo/lib/contracts.ts with these addresses");
  console.log("   2. Get test tokens (see DEPLOY_TEST.md)");
  console.log("   3. Fund the treasury with Sepolia ETH");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
