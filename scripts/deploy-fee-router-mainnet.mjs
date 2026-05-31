/**
 * WadoozieFeeRouter — Ethereum mainnet deploy.
 *
 * Reads `FEE_ROUTER_DEPLOYER_PRIVATE_KEY` from `.env` (falls back to
 * `DEPLOYER_PRIVATE_KEY`) and submits a one-shot deploy tx to mainnet
 * via the Alchemy endpoint in `.env`'s `ETHEREUM_RPC_URL` (or
 * `NEXT_PUBLIC_MAINNET_RPC_URL` if that's not set).
 *
 * The private key is never logged. The deployer EOA only pays gas;
 * ownership of the contract is set to `OWNER` in the constructor.
 *
 * Strict guards:
 *   - chainId must be 1 (mainnet). Refuses to broadcast on any other
 *     chain. Protects against a misconfigured RPC silently shipping
 *     to a fork or a wrong testnet.
 *   - Deployer must have at least `MIN_DEPLOYER_ETH_WEI` so the tx
 *     can't run out of gas mid-flight.
 *   - eth_estimateGas first; if the estimate is wildly different
 *     from the expected ~1.4M, refuses to broadcast.
 *
 * On success, writes the deployment record to
 * `deployments-flat/fee-router.mainnet.json` so the FE wire-in step
 * has a single source of truth for the address + tx hash + block.
 */

import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, getAddress } from "ethers";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const OWNER = getAddress("0xD01E81D52E6aCa955b8A1fEe72069D310B5a787A");
const FEE_RECIPIENT = getAddress("0xD01E81D52E6aCa955b8A1fEe72069D310B5a787A");
const WADZ = getAddress("0x8a730da6d4f483917a53072d9a8e5eef4b105d72");
const WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const V2_ROUTER = getAddress("0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D");
const FEE_BPS = 75;

// Refuse to deploy if the deployer has < 0.001 ETH. Even at a 50 gwei
// spike the contract only costs ~0.07 ETH, but we keep this very low
// to avoid blocking deploys when gas is cheap (mainnet is currently
// at 0.13 gwei).
const MIN_DEPLOYER_ETH_WEI = 1_000_000_000_000_000n; // 0.001 ETH

// The contract is ~260 LoC with OZ Ownable + Pausable + ReentrancyGuard
// inheritance. Empirical deploy gas: ~1.4-1.6M. We refuse to broadcast
// if the estimate is more than 2x that — defensive guard against an
// RPC bug or a bytecode mismatch.
const MAX_GAS_ESTIMATE = 3_000_000n;

function loadArtifact() {
	const path = join(
		ROOT,
		"artifacts/contracts/WadoozieFeeRouter.sol/WadoozieFeeRouter.json"
	);
	const json = JSON.parse(readFileSync(path, "utf8"));
	return { abi: json.abi, bytecode: json.bytecode };
}

function fmtEth(wei) {
	return `${Number(wei) / 1e18} ETH`;
}

function fmtGwei(weiPerGas) {
	return `${(Number(weiPerGas) / 1e9).toFixed(3)} gwei`;
}

async function main() {
	const pk =
		process.env.FEE_ROUTER_DEPLOYER_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
	if (!pk) {
		console.error(
			"Missing FEE_ROUTER_DEPLOYER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) in .env"
		);
		process.exit(1);
	}

	const rpcUrl =
		process.env.ETHEREUM_RPC_URL ??
		process.env.NEXT_PUBLIC_MAINNET_RPC_URL ??
		"";
	if (!rpcUrl) {
		console.error(
			"Missing ETHEREUM_RPC_URL (or NEXT_PUBLIC_MAINNET_RPC_URL) in .env"
		);
		process.exit(1);
	}

	const provider = new JsonRpcProvider(rpcUrl);
	const wallet = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);

	console.log("─".repeat(64));
	console.log("WadoozieFeeRouter — MAINNET deploy");
	console.log("─".repeat(64));
	const network = await provider.getNetwork();
	console.log("rpc network: chainId", Number(network.chainId), `(${network.name})`);
	if (network.chainId !== 1n) {
		console.error(
			`REFUSING: RPC says chainId=${network.chainId}, but this script only runs on Ethereum mainnet (1).`
		);
		process.exit(1);
	}

	console.log("deployer:     ", wallet.address);
	const balance = await provider.getBalance(wallet.address);
	console.log("deployer ETH:  ", fmtEth(balance));
	if (balance < MIN_DEPLOYER_ETH_WEI) {
		console.error(
			`REFUSING: deployer has ${fmtEth(balance)}, need at least ${fmtEth(MIN_DEPLOYER_ETH_WEI)}.`
		);
		process.exit(1);
	}

	const feeData = await provider.getFeeData();
	console.log("gasPrice:     ", feeData.gasPrice ? fmtGwei(feeData.gasPrice) : "?");
	console.log(
		"maxFeePerGas: ",
		feeData.maxFeePerGas ? fmtGwei(feeData.maxFeePerGas) : "?"
	);

	console.log("\nconstructor args:");
	console.log("  WADZ         ", WADZ);
	console.log("  WETH         ", WETH);
	console.log("  v2Router     ", V2_ROUTER);
	console.log("  owner        ", OWNER);
	console.log("  feeRecipient ", FEE_RECIPIENT);
	console.log("  feeBps       ", FEE_BPS);

	const { abi, bytecode } = loadArtifact();
	const factory = new ContractFactory(abi, bytecode, wallet);

	console.log("\nestimating gas…");
	const deployTx = await factory.getDeployTransaction(
		WADZ,
		WETH,
		V2_ROUTER,
		OWNER,
		FEE_RECIPIENT,
		FEE_BPS
	);
	const gasEstimate = await provider.estimateGas({
		...deployTx,
		from: wallet.address,
	});
	console.log("estimateGas:  ", gasEstimate.toString());
	if (gasEstimate > MAX_GAS_ESTIMATE) {
		console.error(
			`REFUSING: gasEstimate=${gasEstimate} > ${MAX_GAS_ESTIMATE}. Suspect bytecode mismatch.`
		);
		process.exit(1);
	}

	if (feeData.maxFeePerGas) {
		const worstCaseCostWei = gasEstimate * feeData.maxFeePerGas;
		console.log("worst-case:   ", fmtEth(worstCaseCostWei));
		if (worstCaseCostWei > balance) {
			console.error(
				`REFUSING: worst-case deploy cost ${fmtEth(worstCaseCostWei)} exceeds deployer balance ${fmtEth(balance)}.`
			);
			process.exit(1);
		}
	}

	console.log("\n→ broadcasting deploy tx…");
	const contract = await factory.deploy(
		WADZ,
		WETH,
		V2_ROUTER,
		OWNER,
		FEE_RECIPIENT,
		FEE_BPS
	);
	const tx = contract.deploymentTransaction();
	console.log("tx hash:      ", tx.hash);
	console.log("waiting for receipt…");
	const receipt = await tx.wait();
	const address = await contract.getAddress();

	console.log("─".repeat(64));
	console.log("DEPLOYED");
	console.log("─".repeat(64));
	console.log("address:       ", address);
	console.log("blockNumber:   ", receipt.blockNumber);
	console.log("gasUsed:       ", receipt.gasUsed.toString());
	if (receipt.effectiveGasPrice) {
		console.log("effectiveGas:  ", fmtGwei(receipt.effectiveGasPrice));
		const actualCost = receipt.gasUsed * receipt.effectiveGasPrice;
		console.log("actualCost:    ", fmtEth(actualCost));
	}

	console.log("\nreading back on-chain state…");
	const reader = new Contract(address, abi, provider);
	const ownerOnChain = await reader.owner();
	const feeRecipientOnChain = await reader.feeRecipient();
	const feeBpsOnChain = await reader.feeBps();
	const minFee = await reader.MIN_FEE_BPS();
	const maxFee = await reader.MAX_FEE_BPS();
	const wadzOnChain = await reader.WADZ();
	const wethOnChain = await reader.WETH();
	const routerOnChain = await reader.router();

	console.log("  owner          ", ownerOnChain);
	console.log("  feeRecipient   ", feeRecipientOnChain);
	console.log("  feeBps         ", Number(feeBpsOnChain), "bps");
	console.log("  MIN_FEE_BPS    ", Number(minFee), "bps");
	console.log("  MAX_FEE_BPS    ", Number(maxFee), "bps");
	console.log("  WADZ           ", wadzOnChain);
	console.log("  WETH           ", wethOnChain);
	console.log("  router         ", routerOnChain);

	const ok =
		ownerOnChain.toLowerCase() === OWNER.toLowerCase() &&
		feeRecipientOnChain.toLowerCase() === FEE_RECIPIENT.toLowerCase() &&
		Number(feeBpsOnChain) === FEE_BPS &&
		Number(minFee) === 50 &&
		Number(maxFee) === 100 &&
		wadzOnChain.toLowerCase() === WADZ.toLowerCase() &&
		wethOnChain.toLowerCase() === WETH.toLowerCase() &&
		routerOnChain.toLowerCase() === V2_ROUTER.toLowerCase();

	if (!ok) {
		console.error("\n✗ INVARIANT MISMATCH — on-chain state does not match constructor args");
		process.exit(1);
	}
	console.log("\n✓ all invariants hold");

	const record = {
		network: "mainnet",
		chainId: 1,
		address,
		txHash: tx.hash,
		blockNumber: receipt.blockNumber,
		deployer: wallet.address,
		deployedAt: new Date().toISOString(),
		constructorArgs: {
			wadz: WADZ,
			weth: WETH,
			router: V2_ROUTER,
			owner: OWNER,
			feeRecipient: FEE_RECIPIENT,
			feeBps: FEE_BPS,
		},
	};
	const recordDir = join(ROOT, "deployments-flat");
	mkdirSync(recordDir, { recursive: true });
	const recordPath = join(recordDir, "fee-router.mainnet.json");
	writeFileSync(recordPath, JSON.stringify(record, null, 2));
	console.log("\ndeployment record:", recordPath);

	console.log("\n─── next steps ──────────────────────────────────────────");
	console.log("1. Verify on Etherscan:");
	console.log(
		`   npx hardhat verify --network mainnet ${address} \\\n` +
			`     "${WADZ}" "${WETH}" "${V2_ROUTER}" \\\n` +
			`     "${OWNER}" "${FEE_RECIPIENT}" ${FEE_BPS}`
	);
	console.log("\n2. Wire frontend (frontend/.env.local):");
	console.log(`   NEXT_PUBLIC_WADZ_FEE_ROUTER_ADDRESS=${address}`);
	console.log("   NEXT_PUBLIC_WADZ_FEE_BPS=75");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
