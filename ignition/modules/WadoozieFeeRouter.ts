import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * WadoozieFeeRouter — Hardhat Ignition deployment module.
 *
 * Deploys the fee router and wires it to a pre-existing WADZ token,
 * Uniswap V2 router, owner address, and fee recipient. All five
 * inputs are passed as module parameters so the same module reuses
 * across mainnet, Sepolia, and forked-mainnet tests without code edits.
 *
 * Defaults are wired for mainnet:
 *   - WADZ:         0x8A730Da6D4f483917A53072d9A8e5eEF4b105d72 (current deploy)
 *   - WETH:         0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
 *   - Router02:     0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
 *   - owner:        0xD01E81D52E6aCa955b8A1fEe72069D310B5a787A
 *   - feeRecipient: 0xD01E81D52E6aCa955b8A1fEe72069D310B5a787A (same address — receives the fees)
 *   - initialFeeBps: 75 (0.75%) — sits mid-range between the 50 bps
 *                                 floor and the 100 bps cap.
 *
 * **Deployer ≠ owner.** The EOA that signs the deploy tx (account 0
 * by default) only pays gas. Ownership of the contract is set to
 * `owner` in the constructor, so the deployer hot key has zero
 * post-deploy control. This is the right shape for a production
 * deploy where a multisig is the long-term controller.
 *
 * Sepolia + local: override the addresses via Ignition parameters file.
 * Example:
 *
 *   pnpm hardhat ignition deploy ignition/modules/WadoozieFeeRouter.ts \
 *     --network mainnet \
 *     --parameters ignition/params/fee-router.mainnet.json
 */

// Mainnet defaults. Anyone deploying to a different network MUST override
// these via the parameters file.
const MAINNET_WADZ = "0x8A730Da6D4f483917A53072d9A8e5eEF4b105d72";
const MAINNET_WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const MAINNET_UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

// Wadoozie ops wallet — receives fees AND has owner privileges over
// the fee router. Both roles point to the same address by request.
// To diverge them later, redeploy with split addresses or override
// via the params file.
const DEFAULT_OWNER = "0xD01E81D52E6aCa955b8A1fEe72069D310B5a787A";
const DEFAULT_FEE_RECIPIENT = "0xD01E81D52E6aCa955b8A1fEe72069D310B5a787A";

const WadoozieFeeRouterModule = buildModule("WadoozieFeeRouterModule", (m) => {
	const wadz = m.getParameter<string>("wadz", MAINNET_WADZ);
	const weth = m.getParameter<string>("weth", MAINNET_WETH);
	const router = m.getParameter<string>("router", MAINNET_UNISWAP_V2_ROUTER);
	const owner = m.getParameter<string>("owner", DEFAULT_OWNER);
	const feeRecipient = m.getParameter<string>("feeRecipient", DEFAULT_FEE_RECIPIENT);

	// 75 bps = 0.75%. Caller can lower (down to MIN_FEE_BPS = 50) or
	// raise (up to MAX_FEE_BPS = 100) post-deploy via `setFeeBps`.
	const initialFeeBps = m.getParameter<number>("initialFeeBps", 75);

	const feeRouter = m.contract("WadoozieFeeRouter", [
		wadz,
		weth,
		router,
		owner,
		feeRecipient,
		initialFeeBps,
	]);

	return { feeRouter };
});

export default WadoozieFeeRouterModule;
