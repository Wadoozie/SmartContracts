import { expect } from "chai";
import { network } from "hardhat";

/**
 * WadoozieFeeRouter — unit tests.
 *
 * The router wraps a Uniswap V2 router and skims a configurable fee
 * (default 75 bps / 0.75%, bounded by a 50 bps floor and a 100 bps
 * cap) on every swap. Tests cover all three spend shapes (ETH-in,
 * ERC20-in, WADZ-out), the admin surface (set / pause / rescue) and
 * the safety invariants (fee floor + cap, zero address checks, paused
 * gate, explicit-owner separation from deployer EOA).
 *
 * Strategy: deploy a `MockV2Router` instead of forking mainnet — keeps the
 * suite hermetic and fast. The mock pulls the input token via
 * `transferFrom` (so we exercise the approve path on our router), and
 * pays out a pre-registered `amountsToReturn` array funded by the
 * fixture. The mock holds ETH for sell-side payouts (funded explicitly
 * inside each test that needs it).
 *
 * WADZ is the production Wadoozie token — not just an ERC20 stub —
 * because we want the same `_update` hook semantics (auto-delegation on
 * first transfer) that ship to mainnet. A separate MockERC20 contract
 * supplies the stand-in WETH + stablecoin tokens.
 */

const connection = await network.connect();
const { ethers, networkHelpers } = connection;

describe("WadoozieFeeRouter", () => {
	const FIVE_MIN = 60 * 5;

	async function deployFixture() {
		// `multisig` stands in for the production owner — a separate
		// signer from `deployer` to exercise the explicit-owner deploy
		// flow. The deployer EOA pays gas + signs the tx, but the
		// constructor sets ownership to `multisig`, so the deployer
		// has no power over the contract once the tx mines.
		const [
			deployer,
			lpWallet,
			treasury,
			publisherRewards,
			signalFragments,
			teamVesting,
			user,
			feeRecipient,
			multisig,
			otherOwner,
		] = await ethers.getSigners();

		// Deploy the real WADZ token. This mirrors mainnet exactly so the
		// approve / transferFrom semantics in the router test against the
		// same code path the production token will run.
		const wadzFactory = await ethers.getContractFactory("Wadoozie");
		const wadz = await wadzFactory.deploy(
			deployer.address,
			lpWallet.address,
			treasury.address,
			publisherRewards.address,
			signalFragments.address,
			teamVesting.address
		);
		await wadz.waitForDeployment();

		// MockERC20 stand-ins for WETH + USDC. WETH is just any ERC20 from
		// the router's point of view (the wrapping happens inside the real
		// V2 router; we mock that surface). USDC is the stablecoin spend-
		// side token — `decimals` doesn't actually matter for our math
		// (we move raw uint256 amounts), but using 6 mirrors mainnet USDC
		// shape for any tests that wire it deeper later.
		const erc20Factory = await ethers.getContractFactory("MockERC20");
		const weth = await erc20Factory.deploy("Wrapped Ether (mock)", "WETH", 18);
		await weth.waitForDeployment();
		const usdc = await erc20Factory.deploy("USD Coin (mock)", "USDC", 6);
		await usdc.waitForDeployment();

		// Mock Uniswap V2 router.
		const mockRouterFactory = await ethers.getContractFactory("MockV2Router");
		const mockRouter = await mockRouterFactory.deploy();
		await mockRouter.waitForDeployment();

		// Fee router under test. `deployer` signs the tx; `multisig`
		// becomes the owner. Default fee is 75 bps (0.75%) — the
		// launch-day target, sits mid-range between the 50 bps floor
		// and the 100 bps cap.
		const feeRouterFactory = await ethers.getContractFactory("WadoozieFeeRouter");
		const feeRouter = await feeRouterFactory.connect(deployer).deploy(
			await wadz.getAddress(),
			await weth.getAddress(),
			await mockRouter.getAddress(),
			multisig.address,
			feeRecipient.address,
			75 // 0.75%
		);
		await feeRouter.waitForDeployment();

		// Fund the user with USDC for buy-with-token tests. 1M USDC = enough
		// for any sane test buy amount.
		await usdc.mint(user.address, ethers.parseUnits("1000000", 6));

		// Fund the mock router with WADZ + ETH so it can pay outputs.
		// In real Uniswap, the router would consult the pool; here we just
		// pre-load the mock with the WADZ it needs to deliver.
		await wadz.connect(lpWallet).transfer(await mockRouter.getAddress(), ethers.parseEther("100000000"));
		await deployer.sendTransaction({
			to: await mockRouter.getAddress(),
			value: ethers.parseEther("1000"),
		});

		return {
			deployer,
			lpWallet,
			treasury,
			user,
			feeRecipient,
			multisig,
			otherOwner,
			wadz,
			weth,
			usdc,
			mockRouter,
			feeRouter,
		};
	}

	describe("constructor", () => {
		it("stores the addresses + initial fee correctly", async () => {
			const { feeRouter, wadz, weth, mockRouter, feeRecipient, multisig } =
				await networkHelpers.loadFixture(deployFixture);

			expect(await feeRouter.WADZ()).to.equal(await wadz.getAddress());
			expect(await feeRouter.WETH()).to.equal(await weth.getAddress());
			expect(await feeRouter.router()).to.equal(await mockRouter.getAddress());
			expect(await feeRouter.feeRecipient()).to.equal(feeRecipient.address);
			expect(await feeRouter.feeBps()).to.equal(75);
			expect(await feeRouter.MIN_FEE_BPS()).to.equal(50);
			expect(await feeRouter.MAX_FEE_BPS()).to.equal(100);
			expect(await feeRouter.BPS_DENOMINATOR()).to.equal(10_000);
			// Ownership belongs to the explicit constructor arg, NOT the
			// deployer EOA. This is the production deploy shape:
			// hot-key deployer with no post-deploy control.
			expect(await feeRouter.owner()).to.equal(multisig.address);
		});

		it("deployer EOA holds no owner role after construction", async () => {
			const { feeRouter, deployer } = await networkHelpers.loadFixture(deployFixture);
			await expect(feeRouter.connect(deployer).setFeeBps(75)).to.be.revertedWithCustomError(
				feeRouter,
				"OwnableUnauthorizedAccount"
			);
		});

		it("reverts on zero addresses", async () => {
			const [deployer] = await ethers.getSigners();
			const wadzFactory = await ethers.getContractFactory("WadoozieFeeRouter");

			// Each zero-address slot in turn — fail-fast on every input.
			const ZA = ethers.ZeroAddress;
			const ok = deployer.address; // any non-zero
			// args order: wadz, weth, router, owner, feeRecipient, feeBps
			await expect(wadzFactory.deploy(ZA, ok, ok, ok, ok, 75)).to.be.revertedWithCustomError(
				wadzFactory,
				"ZeroAddress"
			);
			await expect(wadzFactory.deploy(ok, ZA, ok, ok, ok, 75)).to.be.revertedWithCustomError(
				wadzFactory,
				"ZeroAddress"
			);
			await expect(wadzFactory.deploy(ok, ok, ZA, ok, ok, 75)).to.be.revertedWithCustomError(
				wadzFactory,
				"ZeroAddress"
			);
			// Ownable v5's constructor rejects `address(0)` with
			// its own custom error, which fires BEFORE our body-level
			// ZeroAddress check (`Ownable(owner_)` is evaluated as
			// part of the parent constructor list). So zero-owner
			// reverts with `OwnableInvalidOwner`, not `ZeroAddress`
			// — assert that exact path so the test stays meaningful.
			await expect(wadzFactory.deploy(ok, ok, ok, ZA, ok, 75)).to.be.revertedWithCustomError(
				wadzFactory,
				"OwnableInvalidOwner"
			);
			await expect(wadzFactory.deploy(ok, ok, ok, ok, ZA, 75)).to.be.revertedWithCustomError(
				wadzFactory,
				"ZeroAddress"
			);
		});

		it("reverts if initial fee exceeds the cap", async () => {
			const [deployer] = await ethers.getSigners();
			const wadzFactory = await ethers.getContractFactory("WadoozieFeeRouter");
			const ok = deployer.address;
			await expect(wadzFactory.deploy(ok, ok, ok, ok, ok, 101))
				.to.be.revertedWithCustomError(wadzFactory, "FeeExceedsCap")
				.withArgs(101, 100);
		});

		it("reverts if initial fee is below the floor", async () => {
			const [deployer] = await ethers.getSigners();
			const wadzFactory = await ethers.getContractFactory("WadoozieFeeRouter");
			const ok = deployer.address;
			await expect(wadzFactory.deploy(ok, ok, ok, ok, ok, 49))
				.to.be.revertedWithCustomError(wadzFactory, "FeeBelowFloor")
				.withArgs(49, 50);
		});

		it("accepts both endpoints of the fee range (50 and 100)", async () => {
			const [deployer] = await ethers.getSigners();
			const wadzFactory = await ethers.getContractFactory("WadoozieFeeRouter");
			const ok = deployer.address;
			const floor = await wadzFactory.deploy(ok, ok, ok, ok, ok, 50);
			await floor.waitForDeployment();
			expect(await floor.feeBps()).to.equal(50);

			const cap = await wadzFactory.deploy(ok, ok, ok, ok, ok, 100);
			await cap.waitForDeployment();
			expect(await cap.feeBps()).to.equal(100);
		});
	});

	describe("buyWadzWithETH", () => {
		it("skims the fee in ETH, forwards remainder to the router, delivers WADZ to msg.sender", async () => {
			const { feeRouter, user, mockRouter, feeRecipient, wadz, weth } =
				await networkHelpers.loadFixture(deployFixture);

			const grossEth = ethers.parseEther("1");
			const expectedFeeEth = (grossEth * 75n) / 10_000n; // 0.75%
			const expectedNetEth = grossEth - expectedFeeEth;
			const wadzOut = ethers.parseEther("19900");

			// Pre-register what the mock router will pay out as `amounts`.
			// Two-element path → [amountIn, amountOut].
			await mockRouter.setAmountsToReturn([expectedNetEth, wadzOut]);

			const feeRecipientEthBefore = await ethers.provider.getBalance(feeRecipient.address);
			const userWadzBefore = await wadz.balanceOf(user.address);

			await expect(
				feeRouter.connect(user).buyWadzWithETH(0, (await currentBlockTimestamp()) + FIVE_MIN, {
					value: grossEth,
				})
			)
				.to.emit(feeRouter, "BuyExecuted")
				.withArgs(user.address, ethers.ZeroAddress, grossEth, expectedFeeEth, expectedNetEth, wadzOut)
				.and.to.emit(mockRouter, "SwapExactETHForTokensCalled")
				.withArgs(
					expectedNetEth,
					0,
					[await weth.getAddress(), await wadz.getAddress()],
					user.address, // user is the direct WADZ recipient
					anyValue() // deadline
				);

			expect(await ethers.provider.getBalance(feeRecipient.address)).to.equal(
				feeRecipientEthBefore + expectedFeeEth
			);
			expect(await wadz.balanceOf(user.address)).to.equal(userWadzBefore + wadzOut);
		});

		it("reverts on msg.value == 0", async () => {
			const { feeRouter, user } = await networkHelpers.loadFixture(deployFixture);
			await expect(
				feeRouter.connect(user).buyWadzWithETH(0, (await currentBlockTimestamp()) + FIVE_MIN, {
					value: 0,
				})
			).to.be.revertedWithCustomError(feeRouter, "ZeroAmount");
		});

		it("reverts when paused", async () => {
			const { feeRouter, user, multisig } = await networkHelpers.loadFixture(deployFixture);
			await feeRouter.connect(multisig).pause();
			await expect(
				feeRouter.connect(user).buyWadzWithETH(0, (await currentBlockTimestamp()) + FIVE_MIN, {
					value: ethers.parseEther("1"),
				})
			).to.be.revertedWithCustomError(feeRouter, "EnforcedPause");
		});

		it("works at the fee floor (50 bps / 0.5%)", async () => {
			const { feeRouter, multisig, user, mockRouter, feeRecipient } =
				await networkHelpers.loadFixture(deployFixture);
			await feeRouter.connect(multisig).setFeeBps(50);

			const grossEth = ethers.parseEther("1");
			const expectedFee = (grossEth * 50n) / 10_000n; // 0.5%
			const expectedNet = grossEth - expectedFee;
			const wadzOut = ethers.parseEther("19950");
			await mockRouter.setAmountsToReturn([expectedNet, wadzOut]);

			const feeRecipientEthBefore = await ethers.provider.getBalance(feeRecipient.address);
			await feeRouter
				.connect(user)
				.buyWadzWithETH(0, (await currentBlockTimestamp()) + FIVE_MIN, { value: grossEth });

			expect(await ethers.provider.getBalance(feeRecipient.address)).to.equal(
				feeRecipientEthBefore + expectedFee
			);
		});
	});

	describe("buyWadzWithToken (USDC → WADZ)", () => {
		it("pulls USDC from user, skims fee in USDC, calls swapExactTokensForTokens with [USDC, WETH, WADZ]", async () => {
			const { feeRouter, user, mockRouter, feeRecipient, wadz, weth, usdc } =
				await networkHelpers.loadFixture(deployFixture);

			const grossUsdc = ethers.parseUnits("100", 6); // 100 USDC
			const expectedFee = (grossUsdc * 75n) / 10_000n; // 0.75%
			const expectedNet = grossUsdc - expectedFee;
			const wadzOut = ethers.parseEther("9925");

			await mockRouter.setAmountsToReturn([expectedNet, 0n, wadzOut]); // 3-leg path

			await usdc.connect(user).approve(await feeRouter.getAddress(), grossUsdc);

			const feeRecipientUsdcBefore = await usdc.balanceOf(feeRecipient.address);
			const userWadzBefore = await wadz.balanceOf(user.address);

			await expect(
				feeRouter
					.connect(user)
					.buyWadzWithToken(
						await usdc.getAddress(),
						grossUsdc,
						0,
						(await currentBlockTimestamp()) + FIVE_MIN
					)
			)
				.to.emit(feeRouter, "BuyExecuted")
				.withArgs(user.address, await usdc.getAddress(), grossUsdc, expectedFee, expectedNet, wadzOut)
				.and.to.emit(mockRouter, "SwapExactTokensForTokensCalled")
				.withArgs(
					expectedNet,
					0,
					[await usdc.getAddress(), await weth.getAddress(), await wadz.getAddress()],
					user.address,
					anyValue()
				);

			expect(await usdc.balanceOf(feeRecipient.address)).to.equal(feeRecipientUsdcBefore + expectedFee);
			expect(await wadz.balanceOf(user.address)).to.equal(userWadzBefore + wadzOut);
			expect(await usdc.balanceOf(await feeRouter.getAddress())).to.equal(0); // no dust left
		});

		it("rejects WADZ as input token", async () => {
			const { feeRouter, user, wadz } = await networkHelpers.loadFixture(deployFixture);
			await expect(
				feeRouter
					.connect(user)
					.buyWadzWithToken(
						await wadz.getAddress(),
						100,
						0,
						(await currentBlockTimestamp()) + FIVE_MIN
					)
			).to.be.revertedWithCustomError(feeRouter, "InvalidInputToken");
		});

		it("rejects WETH as input token (force users into the ETH path)", async () => {
			const { feeRouter, user, weth } = await networkHelpers.loadFixture(deployFixture);
			await expect(
				feeRouter
					.connect(user)
					.buyWadzWithToken(
						await weth.getAddress(),
						100,
						0,
						(await currentBlockTimestamp()) + FIVE_MIN
					)
			).to.be.revertedWithCustomError(feeRouter, "InvalidInputToken");
		});

		it("rejects zero input token address", async () => {
			const { feeRouter, user } = await networkHelpers.loadFixture(deployFixture);
			await expect(
				feeRouter
					.connect(user)
					.buyWadzWithToken(
						ethers.ZeroAddress,
						100,
						0,
						(await currentBlockTimestamp()) + FIVE_MIN
					)
			).to.be.revertedWithCustomError(feeRouter, "ZeroAddress");
		});

		it("rejects zero amount", async () => {
			const { feeRouter, user, usdc } = await networkHelpers.loadFixture(deployFixture);
			await expect(
				feeRouter
					.connect(user)
					.buyWadzWithToken(
						await usdc.getAddress(),
						0,
						0,
						(await currentBlockTimestamp()) + FIVE_MIN
					)
			).to.be.revertedWithCustomError(feeRouter, "ZeroAmount");
		});
	});

	describe("sellWadzForETH", () => {
		it("pulls WADZ, skims fee in WADZ, calls swapExactTokensForETH with [WADZ, WETH], delivers ETH to user", async () => {
			const { feeRouter, user, mockRouter, feeRecipient, wadz, weth, lpWallet } =
				await networkHelpers.loadFixture(deployFixture);

			// Give the user some WADZ to sell. lpWallet has the LP allocation
			// from the constructor; transfer a chunk to the user.
			const sellAmount = ethers.parseEther("10000");
			await wadz.connect(lpWallet).transfer(user.address, sellAmount);

			const expectedFee = (sellAmount * 75n) / 10_000n; // 0.75%
			const expectedNet = sellAmount - expectedFee;
			const ethOut = ethers.parseEther("0.5");
			await mockRouter.setAmountsToReturn([expectedNet, ethOut]);

			await wadz.connect(user).approve(await feeRouter.getAddress(), sellAmount);

			const userEthBefore = await ethers.provider.getBalance(user.address);
			const feeRecipientWadzBefore = await wadz.balanceOf(feeRecipient.address);

			const tx = await feeRouter
				.connect(user)
				.sellWadzForETH(sellAmount, 0, (await currentBlockTimestamp()) + FIVE_MIN);
			const receipt = await tx.wait();
			const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

			expect(await wadz.balanceOf(feeRecipient.address)).to.equal(feeRecipientWadzBefore + expectedFee);
			expect(await ethers.provider.getBalance(user.address)).to.equal(
				userEthBefore + ethOut - gasUsed
			);
			expect(await wadz.balanceOf(user.address)).to.equal(0); // entire sold balance moved

			await expect(tx)
				.to.emit(feeRouter, "SellExecuted")
				.withArgs(user.address, sellAmount, expectedFee, expectedNet, ethOut)
				.and.to.emit(mockRouter, "SwapExactTokensForETHCalled")
				.withArgs(
					expectedNet,
					0,
					[await wadz.getAddress(), await weth.getAddress()],
					user.address,
					anyValue()
				);
		});

		it("reverts on zero amount", async () => {
			const { feeRouter, user } = await networkHelpers.loadFixture(deployFixture);
			await expect(
				feeRouter.connect(user).sellWadzForETH(0, 0, (await currentBlockTimestamp()) + FIVE_MIN)
			).to.be.revertedWithCustomError(feeRouter, "ZeroAmount");
		});

		it("reverts when paused", async () => {
			const { feeRouter, multisig, user } = await networkHelpers.loadFixture(deployFixture);
			await feeRouter.connect(multisig).pause();
			await expect(
				feeRouter
					.connect(user)
					.sellWadzForETH(ethers.parseEther("1"), 0, (await currentBlockTimestamp()) + FIVE_MIN)
			).to.be.revertedWithCustomError(feeRouter, "EnforcedPause");
		});
	});

	describe("admin", () => {
		it("setFeeBps respects the cap and emits", async () => {
			const { feeRouter, multisig } = await networkHelpers.loadFixture(deployFixture);
			await expect(feeRouter.connect(multisig).setFeeBps(100))
				.to.emit(feeRouter, "FeeBpsUpdated")
				.withArgs(75, 100);
			expect(await feeRouter.feeBps()).to.equal(100);

			await expect(feeRouter.connect(multisig).setFeeBps(101))
				.to.be.revertedWithCustomError(feeRouter, "FeeExceedsCap")
				.withArgs(101, 100);
		});

		it("setFeeBps respects the floor and emits", async () => {
			const { feeRouter, multisig } = await networkHelpers.loadFixture(deployFixture);
			await expect(feeRouter.connect(multisig).setFeeBps(50))
				.to.emit(feeRouter, "FeeBpsUpdated")
				.withArgs(75, 50);
			expect(await feeRouter.feeBps()).to.equal(50);

			await expect(feeRouter.connect(multisig).setFeeBps(49))
				.to.be.revertedWithCustomError(feeRouter, "FeeBelowFloor")
				.withArgs(49, 50);
			await expect(feeRouter.connect(multisig).setFeeBps(0))
				.to.be.revertedWithCustomError(feeRouter, "FeeBelowFloor")
				.withArgs(0, 50);
		});

		it("setFeeBps rejects non-owner (including the deployer EOA)", async () => {
			const { feeRouter, user, deployer } = await networkHelpers.loadFixture(deployFixture);
			await expect(feeRouter.connect(user).setFeeBps(75)).to.be.revertedWithCustomError(
				feeRouter,
				"OwnableUnauthorizedAccount"
			);
			await expect(feeRouter.connect(deployer).setFeeBps(75)).to.be.revertedWithCustomError(
				feeRouter,
				"OwnableUnauthorizedAccount"
			);
		});

		it("feeRecipient is immutable — no setter exists", async () => {
			const { feeRouter } = await networkHelpers.loadFixture(deployFixture);
			// `setFeeRecipient` was intentionally removed: a compromised
			// owner key must not be able to redirect the fee stream. The
			// `feeRecipient` slot is `immutable`, so even a Solidity-level
			// re-binding is impossible. We assert at the ABI level that the
			// function does not exist on the contract interface.
			expect((feeRouter.interface as unknown as { hasFunction: (n: string) => boolean }).hasFunction?.("setFeeRecipient") ?? false).to.equal(false);
			expect(feeRouter.interface.fragments.some((f) => f.type === "function" && (f as { name: string }).name === "setFeeRecipient")).to.equal(false);
		});

		it("setRouter updates + emits + rejects zero + non-owner", async () => {
			const { feeRouter, multisig, otherOwner, user } = await networkHelpers.loadFixture(deployFixture);

			await expect(feeRouter.connect(multisig).setRouter(otherOwner.address))
				.to.emit(feeRouter, "RouterUpdated")
				.withArgs(anyValue(), otherOwner.address);
			expect(await feeRouter.router()).to.equal(otherOwner.address);

			await expect(feeRouter.connect(multisig).setRouter(ethers.ZeroAddress)).to.be.revertedWithCustomError(
				feeRouter,
				"ZeroAddress"
			);

			await expect(feeRouter.connect(user).setRouter(otherOwner.address)).to.be.revertedWithCustomError(
				feeRouter,
				"OwnableUnauthorizedAccount"
			);
		});

		it("pause / unpause are owner-only", async () => {
			const { feeRouter, multisig, user } = await networkHelpers.loadFixture(deployFixture);
			await expect(feeRouter.connect(user).pause()).to.be.revertedWithCustomError(
				feeRouter,
				"OwnableUnauthorizedAccount"
			);
			await feeRouter.connect(multisig).pause();
			expect(await feeRouter.paused()).to.equal(true);
			await feeRouter.connect(multisig).unpause();
			expect(await feeRouter.paused()).to.equal(false);
		});
	});

	describe("rescueTokens / rescueEth", () => {
		it("recovers stuck ERC-20", async () => {
			const { feeRouter, multisig, otherOwner, usdc } = await networkHelpers.loadFixture(deployFixture);
			const stuckAmount = ethers.parseUnits("50", 6);
			await usdc.mint(await feeRouter.getAddress(), stuckAmount);

			await expect(
				feeRouter.connect(multisig).rescueTokens(await usdc.getAddress(), otherOwner.address, stuckAmount)
			)
				.to.emit(feeRouter, "TokensRescued")
				.withArgs(await usdc.getAddress(), otherOwner.address, stuckAmount);

			expect(await usdc.balanceOf(otherOwner.address)).to.equal(stuckAmount);
		});

		it("rescueTokens rejects zero recipient and non-owner", async () => {
			const { feeRouter, multisig, user, usdc } = await networkHelpers.loadFixture(deployFixture);
			await expect(
				feeRouter.connect(multisig).rescueTokens(await usdc.getAddress(), ethers.ZeroAddress, 1)
			).to.be.revertedWithCustomError(feeRouter, "ZeroAddress");
			await expect(
				feeRouter.connect(user).rescueTokens(await usdc.getAddress(), user.address, 1)
			).to.be.revertedWithCustomError(feeRouter, "OwnableUnauthorizedAccount");
		});

		it("rescueEth recovers stuck native", async () => {
			const { feeRouter, deployer, multisig, otherOwner } = await networkHelpers.loadFixture(deployFixture);
			const stuckEth = ethers.parseEther("0.1");
			// Any account can fund the contract — the deployer EOA is
			// the convenient one here since it has ETH from the fixture.
			await deployer.sendTransaction({
				to: await feeRouter.getAddress(),
				value: stuckEth,
			});

			const recipientBefore = await ethers.provider.getBalance(otherOwner.address);

			await expect(feeRouter.connect(multisig).rescueEth(otherOwner.address, stuckEth))
				.to.emit(feeRouter, "EthRescued")
				.withArgs(otherOwner.address, stuckEth);

			expect(await ethers.provider.getBalance(otherOwner.address)).to.equal(
				recipientBefore + stuckEth
			);
		});
	});
});

/* ── Helpers ────────────────────────────────────────────────────────────── */

async function currentBlockTimestamp(): Promise<number> {
	const block = await ethers.provider.getBlock("latest");
	return block!.timestamp;
}

/**
 * Chai/ethers `withArgs` matcher that accepts any value. We use it for
 * the `deadline` argument on swap events because the value is computed
 * from `block.timestamp + 5min` and can drift by a second between the
 * test calling it and the event emitting — tests would be flaky if we
 * pinned the exact deadline.
 */
function anyValue(): unknown {
	// chai-as-promised + hardhat-chai-matchers provides this as a top-
	// level export but the typed signatures differ across versions; the
	// safe path is to return a symbol the matcher treats as "any" — the
	// underlying check is loose-equality with `==`.
	return (val: unknown) => true;
}
