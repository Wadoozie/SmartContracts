import { network } from "hardhat";

const connection = await network.connect();
const { ethers } = connection;

async function main() {
  const [deployer] = await ethers.getSigners();

  const timelock = await ethers.getContractAt(
    "WadoozieTimelock",
    "0x5800bf5aE75549A3FcF050BF7e46aC859917325e"
  );

  const governor = "0x9A5c6aF405CF6830356d08Ad3a3BA73A7A9b4918";

  console.log("Granting roles to HeadQuarters...");

  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
  const DEFAULT_ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();

  // Check if roles are already granted
  const hasProposer = await timelock.hasRole(PROPOSER_ROLE, governor);
  const hasCanceller = await timelock.hasRole(CANCELLER_ROLE, governor);
  const hasAdmin = await timelock.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);

  console.log("\nCurrent roles:");
  console.log("- HeadQuarters has PROPOSER_ROLE:", hasProposer);
  console.log("- HeadQuarters has CANCELLER_ROLE:", hasCanceller);
  console.log("- Deployer has DEFAULT_ADMIN_ROLE:", hasAdmin);

  if (!hasProposer) {
    console.log("\nGranting PROPOSER_ROLE...");
    const tx1 = await timelock.grantRole(PROPOSER_ROLE, governor);
    await tx1.wait();
    console.log("✓ PROPOSER_ROLE granted");
  } else {
    console.log("✓ PROPOSER_ROLE already granted");
  }

  if (!hasCanceller) {
    console.log("\nGranting CANCELLER_ROLE...");
    const tx2 = await timelock.grantRole(CANCELLER_ROLE, governor);
    await tx2.wait();
    console.log("✓ CANCELLER_ROLE granted");
  } else {
    console.log("✓ CANCELLER_ROLE already granted");
  }

  if (hasAdmin) {
    console.log("\nRenouncing DEFAULT_ADMIN_ROLE...");
    const tx3 = await timelock.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);
    await tx3.wait();
    console.log("✓ DEFAULT_ADMIN_ROLE renounced - DAO is now fully decentralized!");
  } else {
    console.log("✓ DEFAULT_ADMIN_ROLE already renounced");
  }

  console.log("\n✅ All roles configured!");
  console.log("\n📋 Deployed Contracts:");
  console.log("  Wadoozie Token:   0xc8A46F5ff702e496de6E14E138488dfc33FF6761");
  console.log("  HeadQuarters:     0x9A5c6aF405CF6830356d08Ad3a3BA73A7A9b4918");
  console.log("  Timelock:         0x5800bf5aE75549A3FcF050BF7e46aC859917325e");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
