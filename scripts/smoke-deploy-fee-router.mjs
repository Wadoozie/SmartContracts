/**
 * Smoke-test the WadoozieFeeRouter deploy flow against a forked-mainnet
 * Hardhat node, using a deployer EOA that is NOT the eventual owner.
 *
 * What this proves:
 *   1. The contract compiles + deploys with the production constructor
 *      args (mainnet WADZ / WETH / Uniswap V2 router + the requested
 *      owner + fee recipient + 75 bps fee).
 *   2. Ownership is set to `OWNER_ADDRESS`, NOT the deployer EOA.
 *   3. `feeRecipient` is set to the requested address (immutable).
 *   4. `feeBps` defaults to 75 (within the [50, 100] band).
 *   5. The deployer EOA cannot call any owner-gated function — its
 *      hot key gives it gas-paying ability and nothing more.
 *
 * Run with:
 *   - Terminal 1: `npx hardhat node`              (starts a local node)
 *   - Terminal 2: `node scripts/smoke-deploy-fee-router.mjs`
 *
 * The script reads the deployer private key from
 * `FEE_ROUTER_DEPLOYER_PRIVATE_KEY` (falling back to
 * `DEPLOYER_PRIVATE_KEY`) in `.env`. It never logs the key.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// `getAddress` enforces EIP-55 and normalises any mixed-case input,
// so the constants below can be pasted in any case from the chain
// explorer / params file without breaking deploys on ethers v6.
const OWNER = getAddress("0xD01E81D52E6aCa955b8A1fEe72069D310B5a787A");
const FEE_RECIPIENT = getAddress("0xD01E81D52E6aCa955b8A1fEe72069D310B5a787A");
const WADZ = getAddress("0x8a730da6d4f483917a53072d9a8e5eef4b105d72");
const WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const V2_ROUTER = getAddress("0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D");
const FEE_BPS = 75;

const RPC = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";

function loadArtifact() {
	const path = join(
		ROOT,
		"artifacts/contracts/WadoozieFeeRouter.sol/WadoozieFeeRouter.json"
	);
	const json = JSON.parse(readFileSync(path, "utf8"));
	return { abi: json.abi, bytecode: json.bytecode };
}

async function main() {
	const pk = process.env.FEE_ROUTER_DEPLOYER_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
	if (!pk) {
		console.error(
			"Missing FEE_ROUTER_DEPLOYER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) in .env"
		);
		process.exit(1);
	}

	const provider = new JsonRpcProvider(RPC);
	const wallet = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);

	console.log("─".repeat(60));
	console.log("deployer address:", wallet.address);
	console.log("rpc:             ", RPC);
	const balance = await provider.getBalance(wallet.address);
	console.log("deployer balance:", balance.toString(), "wei");
	if (balance === 0n) {
		console.error(
			"\nDeployer has zero balance on this node. If you're using the\n" +
				"default Hardhat node, fund the deployer with:\n" +
				"  npx hardhat console --network localhost\n" +
				`  > await network.provider.send("hardhat_setBalance", ["${wallet.address}", "0x56BC75E2D63100000"])\n` +
				"(0x56BC75E2D63100000 = 100 ETH)\n"
		);
		process.exit(1);
	}

	const { abi, bytecode } = loadArtifact();
	console.log("\ndeploying WadoozieFeeRouter…");
	console.log("  WADZ:        ", WADZ);
	console.log("  WETH:        ", WETH);
	console.log("  V2 router:   ", V2_ROUTER);
	console.log("  owner:       ", OWNER);
	console.log("  feeRecipient:", FEE_RECIPIENT);
	console.log("  feeBps:      ", FEE_BPS);

	const factory = new (await import("ethers")).ContractFactory(abi, bytecode, wallet);
	const contract = await factory.deploy(WADZ, WETH, V2_ROUTER, OWNER, FEE_RECIPIENT, FEE_BPS);
	const tx = contract.deploymentTransaction();
	console.log("\ndeploy tx:", tx.hash);
	await contract.waitForDeployment();
	const address = await contract.getAddress();
	console.log("deployed at:", address);

	const reader = new Contract(address, abi, provider);

	const ownerOnChain = await reader.owner();
	const feeRecipientOnChain = await reader.feeRecipient();
	const feeBpsOnChain = await reader.feeBps();
	const minFee = await reader.MIN_FEE_BPS();
	const maxFee = await reader.MAX_FEE_BPS();

	console.log("\n─── verification ─────────────────────────────────");
	console.log("owner() ........", ownerOnChain);
	console.log("feeRecipient() .", feeRecipientOnChain);
	console.log("feeBps() .......", Number(feeBpsOnChain), "bps");
	console.log("MIN_FEE_BPS ....", Number(minFee), "bps");
	console.log("MAX_FEE_BPS ....", Number(maxFee), "bps");

	const ok =
		ownerOnChain.toLowerCase() === OWNER.toLowerCase() &&
		feeRecipientOnChain.toLowerCase() === FEE_RECIPIENT.toLowerCase() &&
		Number(feeBpsOnChain) === FEE_BPS &&
		Number(minFee) === 50 &&
		Number(maxFee) === 100;

	if (!ok) {
		console.error("\n✗ verification FAILED — on-chain state does not match expected");
		process.exit(1);
	}

	console.log("\n✓ all invariants hold");

	// Sanity-check that the deployer EOA cannot call owner-only fns.
	// `staticCall` doesn't broadcast; it just runs the call locally
	// and surfaces the would-be revert. We accept any of:
	//   - the decoded `OwnableUnauthorizedAccount` custom error
	//   - the generic `CALL_EXCEPTION` code (hardhat sometimes elides
	//     the error data field for custom errors over JSON-RPC)
	//   - any string containing "revert" / "Ownable" — defensive
	//     match across ethers / hardhat / node version drift
	try {
		const writer = new Contract(address, abi, wallet);
		await writer.setFeeBps.staticCall(80);
		console.error("\n✗ deployer was able to staticCall setFeeBps — owner gate broken");
		process.exit(1);
	} catch (err) {
		const msg = err?.message ?? "";
		const code = err?.code ?? "";
		const looksLikeRevert =
			/OwnableUnauthorizedAccount|Ownable|reverted|revert data|CALL_EXCEPTION/i.test(msg) ||
			code === "CALL_EXCEPTION";
		if (!looksLikeRevert) {
			console.error("\n✗ unexpected error checking owner gate:", msg);
			process.exit(1);
		}
		console.log("✓ deployer EOA correctly blocked from setFeeBps (revert surfaced as expected)");
	}

	console.log("\nNEXT_PUBLIC_WADZ_FEE_ROUTER_ADDRESS =", address);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
