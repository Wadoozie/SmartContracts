import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import "dotenv/config";

const NETWORK = process.argv[2] || "mainnet";
const COMPILER_VERSION = "v0.8.28+commit.7893614a";
const OPTIMIZATION_RUNS = 200;
const EVM_VERSION = "cancun";
const LICENSE_TYPE = 3;

const CHAIN_IDS = {
  mainnet: 1,
  sepolia: 11155111,
};

const ETHERSCAN_API = "https://api.etherscan.io/v2/api";

function abiEncode(types, values) {
  return ethers.AbiCoder.defaultAbiCoder().encode(types, values).slice(2);
}

async function submitVerification({
  apiKey,
  chainId,
  address,
  contractName,
  source,
  constructorArgs,
}) {
  const body = new URLSearchParams({
    chainid: String(chainId),
    apikey: apiKey,
    module: "contract",
    action: "verifysourcecode",
    contractaddress: address,
    sourceCode: source,
    codeformat: "solidity-single-file",
    contractname: contractName,
    compilerversion: COMPILER_VERSION,
    optimizationUsed: "1",
    runs: String(OPTIMIZATION_RUNS),
    evmversion: EVM_VERSION,
    licenseType: String(LICENSE_TYPE),
    constructorArguements: constructorArgs,
  });

  const res = await fetch(ETHERSCAN_API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (data.status !== "1") {
    if (
      typeof data.result === "string" &&
      data.result.toLowerCase().includes("already verified")
    ) {
      console.log(`  ${contractName}: already verified`);
      return null;
    }
    throw new Error(`Submit failed for ${contractName}: ${data.result}`);
  }
  return data.result;
}

async function pollStatus({ apiKey, chainId, guid, contractName }) {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 5_000));
    const url = `${ETHERSCAN_API}?chainid=${chainId}&module=contract&action=checkverifystatus&guid=${guid}&apikey=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === "1") {
      console.log(`  ${contractName}: verified ✓`);
      return;
    }
    if (
      typeof data.result === "string" &&
      data.result.toLowerCase().includes("pending")
    ) {
      process.stdout.write(".");
      continue;
    }
    throw new Error(`Verification failed for ${contractName}: ${data.result}`);
  }
  throw new Error(`Verification timed out for ${contractName}`);
}

async function verify({ apiKey, chainId, address, contractName, source, constructorArgs }) {
  console.log(`\nVerifying ${contractName} at ${address}...`);
  const guid = await submitVerification({
    apiKey,
    chainId,
    address,
    contractName,
    source,
    constructorArgs,
  });
  if (guid === null) return;
  await pollStatus({ apiKey, chainId, guid, contractName });
}

async function main() {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) throw new Error("ETHERSCAN_API_KEY not set in env");

  const chainId = CHAIN_IDS[NETWORK];
  if (!chainId) throw new Error(`Unknown network: ${NETWORK}`);

  const recordPath = `deployments-flat/${NETWORK}.json`;
  const record = JSON.parse(readFileSync(recordPath, "utf8"));

  console.log(`Network: ${NETWORK} (chainId ${chainId})`);
  console.log(`Deployer: ${record.deployer}`);

  const wadoozieSource = readFileSync("contracts-flat/Wadoozie.sol", "utf8");
  const treasurySource = readFileSync(
    "contracts-flat/WadoozieTreasury.sol",
    "utf8",
  );
  const hqSource = readFileSync("contracts-flat/Headquarters.sol", "utf8");

  const ZERO = "0x0000000000000000000000000000000000000000";

  const wadoozieArgs = abiEncode(
    ["address", "address", "address", "address", "address", "address"],
    [
      record.deployer,
      record.wallets.LP_WALLET,
      record.wallets.TREASURY,
      record.wallets.PUBLISHER_REWARDS,
      record.wallets.SIGNAL_FRAGMENTS,
      record.wallets.TEAM_VESTING,
    ],
  );
  const treasuryArgs = abiEncode(
    ["uint256", "address[]", "address[]", "address"],
    [record.params.timelockDelay, [], [ZERO], record.deployer],
  );
  const hqArgs = abiEncode(
    [
      "address",
      "address",
      "uint48",
      "uint32",
      "uint256",
      "uint256",
      "uint48",
    ],
    [
      record.contracts.Wadoozie,
      record.contracts.WadoozieTreasury,
      record.params.votingDelay,
      record.params.votingPeriod,
      record.params.proposalThreshold,
      record.params.quorumNumerator,
      record.params.voteExtension,
    ],
  );

  await verify({
    apiKey,
    chainId,
    address: record.contracts.Wadoozie,
    contractName: "Wadoozie",
    source: wadoozieSource,
    constructorArgs: wadoozieArgs,
  });

  await verify({
    apiKey,
    chainId,
    address: record.contracts.WadoozieTreasury,
    contractName: "WadoozieTreasury",
    source: treasurySource,
    constructorArgs: treasuryArgs,
  });

  await verify({
    apiKey,
    chainId,
    address: record.contracts.Headquarters,
    contractName: "Headquarters",
    source: hqSource,
    constructorArgs: hqArgs,
  });

  console.log("\nAll three verified.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
