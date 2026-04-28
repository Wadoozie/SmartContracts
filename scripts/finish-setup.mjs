import hre from "hardhat";
import "@nomicfoundation/hardhat-ethers";

const TIMELOCK = "0x0bb95bd21757dA0B20697bd796208648DEf29b95";
const GOVERNOR = "0x9720B160C14DE4520654FFa946638D58d5DcA02f";

async function main() {
  console.log("🔐 Finishing role setup...\n");

  const ethers = hre.ethers;
  const [deployer] = await ethers.getSigners();

  const timelock = await ethers.getContractAt("WadoozieTreasury", TIMELOCK);

  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
  const DEFAULT_ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();

  console.log("Granting PROPOSER_ROLE to Governor...");
  const tx1 = await timelock.grantRole(PROPOSER_ROLE, GOVERNOR);
  await tx1.wait();
  console.log("✅ PROPOSER_ROLE granted");

  console.log("\nGranting CANCELLER_ROLE to Governor...");
  const tx2 = await timelock.grantRole(CANCELLER_ROLE, GOVERNOR);
  await tx2.wait();
  console.log("✅ CANCELLER_ROLE granted");

  console.log("\nRenouncing admin role...");
  const tx3 = await timelock.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);
  await tx3.wait();
  console.log("✅ Admin role renounced");

  console.log("\n🎉 Setup complete! DAO is fully operational.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
