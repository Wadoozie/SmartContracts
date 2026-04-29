import { expect } from "chai";
import { network } from "hardhat";
import { deployDAOFixture, TEST_PARAMS } from "./helpers.js";

const connection = await network.connect();
const { ethers, networkHelpers } = connection;

describe("WadoozieToken", () => {
  // ── Deployment ───────────────────────────────────────────────────────
  describe("Deployment", () => {
    it("should have correct name and symbol", async () => {
      const { token } = await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.name()).to.equal(TEST_PARAMS.TOKEN_NAME);
      expect(await token.symbol()).to.equal(TEST_PARAMS.TOKEN_SYMBOL);
    });

    it("should have total supply of 2B (burn does not decrease supply)", async () => {
      const { token } = await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.totalSupply()).to.equal(TEST_PARAMS.TOTAL_SUPPLY);
    });

    it("should have 18 decimals", async () => {
      const { token } = await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.decimals()).to.equal(18n);
    });
  });

  // ── Genesis Distribution ─────────────────────────────────────────────
  describe("Genesis Distribution", () => {
    it("burn address holds BURN_AT_LAUNCH (999,999,999)", async () => {
      const { token } = await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.balanceOf(TEST_PARAMS.BURN_ADDRESS)).to.equal(
        TEST_PARAMS.BURN_AT_LAUNCH,
      );
    });

    it("LP wallet holds LP_ALLOCATION (750,000,001)", async () => {
      const { token, lpWallet } =
        await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.balanceOf(lpWallet.address)).to.equal(
        TEST_PARAMS.LP_ALLOCATION,
      );
    });

    it("treasury holds TREASURY_ALLOCATION (100,000,000)", async () => {
      const { token, treasury } =
        await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.balanceOf(treasury.address)).to.equal(
        TEST_PARAMS.TREASURY_ALLOCATION,
      );
    });

    it("publisher rewards holds PUBLISHER_ALLOCATION (70,000,000)", async () => {
      const { token, publisher } =
        await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.balanceOf(publisher.address)).to.equal(
        TEST_PARAMS.PUBLISHER_ALLOCATION,
      );
    });

    it("signal fragments holds FRAGMENT_ALLOCATION (50,000,000)", async () => {
      const { token, fragment } =
        await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.balanceOf(fragment.address)).to.equal(
        TEST_PARAMS.FRAGMENT_ALLOCATION,
      );
    });

    it("team vesting holds TEAM_ALLOCATION (30,000,000)", async () => {
      const { token, teamVesting } =
        await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.balanceOf(teamVesting.address)).to.equal(
        TEST_PARAMS.TEAM_ALLOCATION,
      );
    });

    it("deployer holds zero after constructor", async () => {
      const { token, deployer } =
        await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.balanceOf(deployer.address)).to.equal(0n);
    });

    it("sum of all allocations + burn equals TOTAL_SUPPLY", async () => {
      const sum =
        TEST_PARAMS.BURN_AT_LAUNCH +
        TEST_PARAMS.LP_ALLOCATION +
        TEST_PARAMS.TREASURY_ALLOCATION +
        TEST_PARAMS.PUBLISHER_ALLOCATION +
        TEST_PARAMS.FRAGMENT_ALLOCATION +
        TEST_PARAMS.TEAM_ALLOCATION;
      expect(sum).to.equal(TEST_PARAMS.TOTAL_SUPPLY);
    });

    it("immutable getters return the addresses passed to constructor", async () => {
      const { token, lpWallet, treasury, publisher, fragment, teamVesting } =
        await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.LP_WALLET()).to.equal(lpWallet.address);
      expect(await token.TREASURY()).to.equal(treasury.address);
      expect(await token.PUBLISHER_REWARDS()).to.equal(publisher.address);
      expect(await token.SIGNAL_FRAGMENTS()).to.equal(fragment.address);
      expect(await token.TEAM_VESTING()).to.equal(teamVesting.address);
    });

    it("BURN_ADDRESS constant matches 0x...dEaD", async () => {
      const { token } = await networkHelpers.loadFixture(deployDAOFixture);
      expect((await token.BURN_ADDRESS()).toLowerCase()).to.equal(
        TEST_PARAMS.BURN_ADDRESS.toLowerCase(),
      );
    });
  });

  // ── Constructor reverts on zero addresses ────────────────────────────
  describe("Constructor zero-address reverts", () => {
    it("reverts when deployer is zero", async () => {
      const [, lpWallet, treasury, publisher, fragment, teamVesting] =
        await ethers.getSigners();
      await expect(
        ethers.deployContract("Wadoozie", [
          ethers.ZeroAddress,
          lpWallet.address,
          treasury.address,
          publisher.address,
          fragment.address,
          teamVesting.address,
        ]),
      ).to.be.revertedWith("Wadoozie: deployer is zero");
    });

    it("reverts when lp wallet is zero", async () => {
      const [deployer, , treasury, publisher, fragment, teamVesting] =
        await ethers.getSigners();
      await expect(
        ethers.deployContract("Wadoozie", [
          deployer.address,
          ethers.ZeroAddress,
          treasury.address,
          publisher.address,
          fragment.address,
          teamVesting.address,
        ]),
      ).to.be.revertedWith("Wadoozie: lp wallet is zero");
    });

    it("reverts when treasury is zero", async () => {
      const [deployer, lpWallet, , publisher, fragment, teamVesting] =
        await ethers.getSigners();
      await expect(
        ethers.deployContract("Wadoozie", [
          deployer.address,
          lpWallet.address,
          ethers.ZeroAddress,
          publisher.address,
          fragment.address,
          teamVesting.address,
        ]),
      ).to.be.revertedWith("Wadoozie: treasury is zero");
    });

    it("reverts when publisher rewards is zero", async () => {
      const [deployer, lpWallet, treasury, , fragment, teamVesting] =
        await ethers.getSigners();
      await expect(
        ethers.deployContract("Wadoozie", [
          deployer.address,
          lpWallet.address,
          treasury.address,
          ethers.ZeroAddress,
          fragment.address,
          teamVesting.address,
        ]),
      ).to.be.revertedWith("Wadoozie: publisher rewards is zero");
    });

    it("reverts when signal fragments is zero", async () => {
      const [deployer, lpWallet, treasury, publisher, , teamVesting] =
        await ethers.getSigners();
      await expect(
        ethers.deployContract("Wadoozie", [
          deployer.address,
          lpWallet.address,
          treasury.address,
          publisher.address,
          ethers.ZeroAddress,
          teamVesting.address,
        ]),
      ).to.be.revertedWith("Wadoozie: signal fragments is zero");
    });

    it("reverts when team vesting is zero", async () => {
      const [deployer, lpWallet, treasury, publisher, fragment] =
        await ethers.getSigners();
      await expect(
        ethers.deployContract("Wadoozie", [
          deployer.address,
          lpWallet.address,
          treasury.address,
          publisher.address,
          fragment.address,
          ethers.ZeroAddress,
        ]),
      ).to.be.revertedWith("Wadoozie: team vesting is zero");
    });
  });

  // ── Transfers ────────────────────────────────────────────────────────
  describe("Transfers", () => {
    it("should transfer tokens between accounts", async () => {
      const { token, lpWallet, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("1000");

      await expect(
        token.connect(lpWallet).transfer(voter1.address, amount),
      )
        .to.emit(token, "Transfer")
        .withArgs(lpWallet.address, voter1.address, amount);

      expect(await token.balanceOf(voter1.address)).to.equal(amount);
    });

    it("should revert on insufficient balance", async () => {
      const { token, voter1, voter2 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("1");

      await expect(
        token.connect(voter1).transfer(voter2.address, amount),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("should update balances after transfers", async () => {
      const { token, lpWallet, voter1, voter2 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount1 = ethers.parseEther("100");
      const amount2 = ethers.parseEther("50");

      await token.connect(lpWallet).transfer(voter1.address, amount1);
      await token.connect(voter1).transfer(voter2.address, amount2);

      expect(await token.balanceOf(voter1.address)).to.equal(
        amount1 - amount2,
      );
      expect(await token.balanceOf(voter2.address)).to.equal(amount2);
    });
  });

  // ── Permit (gasless approvals) ───────────────────────────────────────
  describe("Permit", () => {
    it("should accept valid permit signature", async () => {
      const { token, lpWallet, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("500");
      const nonce = await token.nonces(lpWallet.address);
      const deadline = BigInt(await networkHelpers.time.latest()) + 3600n;

      const tokenAddress = await token.getAddress();
      const domain = {
        name: TEST_PARAMS.TOKEN_NAME,
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: tokenAddress,
      };
      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        owner: lpWallet.address,
        spender: voter1.address,
        value: amount,
        nonce,
        deadline,
      };

      const sig = await lpWallet.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(sig);

      await token.permit(
        lpWallet.address,
        voter1.address,
        amount,
        deadline,
        v,
        r,
        s,
      );

      expect(
        await token.allowance(lpWallet.address, voter1.address),
      ).to.equal(amount);
    });

    it("should reject expired permit", async () => {
      const { token, lpWallet, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("500");
      const nonce = await token.nonces(lpWallet.address);
      const deadline = BigInt(await networkHelpers.time.latest()) - 1n; // expired

      const tokenAddress = await token.getAddress();
      const domain = {
        name: TEST_PARAMS.TOKEN_NAME,
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: tokenAddress,
      };
      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        owner: lpWallet.address,
        spender: voter1.address,
        value: amount,
        nonce,
        deadline,
      };

      const sig = await lpWallet.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(sig);

      await expect(
        token.permit(
          lpWallet.address,
          voter1.address,
          amount,
          deadline,
          v,
          r,
          s,
        ),
      ).to.be.revertedWithCustomError(token, "ERC2612ExpiredSignature");
    });

    it("should reject invalid signer", async () => {
      const { token, lpWallet, voter1, voter2 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("500");
      const nonce = await token.nonces(lpWallet.address);
      const deadline = BigInt(await networkHelpers.time.latest()) + 3600n;

      const tokenAddress = await token.getAddress();
      const domain = {
        name: TEST_PARAMS.TOKEN_NAME,
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: tokenAddress,
      };
      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        owner: lpWallet.address,
        spender: voter1.address,
        value: amount,
        nonce,
        deadline,
      };

      // voter2 signs instead of lpWallet
      const sig = await voter2.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(sig);

      await expect(
        token.permit(
          lpWallet.address,
          voter1.address,
          amount,
          deadline,
          v,
          r,
          s,
        ),
      ).to.be.revertedWithCustomError(token, "ERC2612InvalidSigner");
    });
  });

  // ── Votes (delegation + checkpointing) ──────────────────────────────
  describe("Votes", () => {
    it("genesis allocation wallets are auto-self-delegated with their allocation", async () => {
      const { token, lpWallet, treasury, publisher, fragment, teamVesting } =
        await networkHelpers.loadFixture(deployDAOFixture);

      expect(await token.delegates(lpWallet.address)).to.equal(
        lpWallet.address,
      );
      expect(await token.getVotes(lpWallet.address)).to.equal(
        TEST_PARAMS.LP_ALLOCATION,
      );

      expect(await token.delegates(treasury.address)).to.equal(
        treasury.address,
      );
      expect(await token.getVotes(treasury.address)).to.equal(
        TEST_PARAMS.TREASURY_ALLOCATION,
      );

      expect(await token.delegates(publisher.address)).to.equal(
        publisher.address,
      );
      expect(await token.getVotes(publisher.address)).to.equal(
        TEST_PARAMS.PUBLISHER_ALLOCATION,
      );

      expect(await token.delegates(fragment.address)).to.equal(
        fragment.address,
      );
      expect(await token.getVotes(fragment.address)).to.equal(
        TEST_PARAMS.FRAGMENT_ALLOCATION,
      );

      expect(await token.delegates(teamVesting.address)).to.equal(
        teamVesting.address,
      );
      expect(await token.getVotes(teamVesting.address)).to.equal(
        TEST_PARAMS.TEAM_ALLOCATION,
      );
    });

    it("burn address is also auto-self-delegated (voting power dormant — no key)", async () => {
      const { token } = await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.delegates(TEST_PARAMS.BURN_ADDRESS)).to.equal(
        TEST_PARAMS.BURN_ADDRESS,
      );
      expect(await token.getVotes(TEST_PARAMS.BURN_ADDRESS)).to.equal(
        TEST_PARAMS.BURN_AT_LAUNCH,
      );
    });

    it("fresh recipient has zero voting power before any delegation", async () => {
      const { token, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.getVotes(voter1.address)).to.equal(0n);
    });

    it("voting power moves on transfer between auto-delegated holders", async () => {
      const { token, lpWallet, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("1000");

      await token.connect(lpWallet).transfer(voter1.address, amount);

      expect(await token.getVotes(voter1.address)).to.equal(amount);
      expect(await token.getVotes(lpWallet.address)).to.equal(
        TEST_PARAMS.LP_ALLOCATION - amount,
      );
    });

    it("explicit delegation overrides auto-self-delegation flow", async () => {
      const { token, lpWallet, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      await token.connect(lpWallet).delegate(voter1.address);
      expect(await token.getVotes(voter1.address)).to.equal(
        TEST_PARAMS.LP_ALLOCATION,
      );
      expect(await token.getVotes(lpWallet.address)).to.equal(0n);
    });

    it("should checkpoint past votes", async () => {
      const { token, lpWallet } =
        await networkHelpers.loadFixture(deployDAOFixture);

      const blockBefore = await ethers.provider.getBlockNumber();
      await networkHelpers.mine(1);

      expect(
        await token.getPastVotes(lpWallet.address, blockBefore),
      ).to.equal(TEST_PARAMS.LP_ALLOCATION);
    });
  });

  // ── Auto-Delegation (WAD-04) ─────────────────────────────────────────
  describe("Auto-Delegation (WAD-04)", () => {
    it("fresh recipient has no delegate before first transfer", async () => {
      const { token, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      expect(await token.delegates(voter1.address)).to.equal(
        ethers.ZeroAddress,
      );
      expect(await token.getVotes(voter1.address)).to.equal(0n);
    });

    it("recipient is auto-self-delegated on first transfer", async () => {
      const { token, lpWallet, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("1000");

      expect(await token.delegates(voter1.address)).to.equal(
        ethers.ZeroAddress,
      );

      await expect(
        token.connect(lpWallet).transfer(voter1.address, amount),
      )
        .to.emit(token, "DelegateChanged")
        .withArgs(voter1.address, ethers.ZeroAddress, voter1.address);

      expect(await token.delegates(voter1.address)).to.equal(voter1.address);
      expect(await token.getVotes(voter1.address)).to.equal(amount);
    });

    it("does not override an existing delegation", async () => {
      const { token, lpWallet, voter1, voter2 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("1000");

      // voter1 delegates to voter2 before ever holding tokens.
      await token.connect(voter1).delegate(voter2.address);
      expect(await token.delegates(voter1.address)).to.equal(voter2.address);

      await token.connect(lpWallet).transfer(voter1.address, amount);

      expect(await token.delegates(voter1.address)).to.equal(voter2.address);
      expect(await token.getVotes(voter2.address)).to.equal(amount);
      expect(await token.getVotes(voter1.address)).to.equal(0n);
    });

    it("second transfer to same recipient does not re-delegate", async () => {
      const { token, lpWallet, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("500");

      await expect(
        token.connect(lpWallet).transfer(voter1.address, amount),
      ).to.emit(token, "DelegateChanged");

      await expect(
        token.connect(lpWallet).transfer(voter1.address, amount),
      ).to.not.emit(token, "DelegateChanged");

      expect(await token.delegates(voter1.address)).to.equal(voter1.address);
      expect(await token.getVotes(voter1.address)).to.equal(amount * 2n);
    });

    it("self-transfer does not fail when already delegated", async () => {
      const { token, lpWallet, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("100");

      // First transfer triggers auto-delegation.
      await token.connect(lpWallet).transfer(voter1.address, amount);
      expect(await token.delegates(voter1.address)).to.equal(voter1.address);

      // Self-transfer should not revert and should leave delegation intact.
      await expect(
        token.connect(voter1).transfer(voter1.address, amount),
      ).to.not.be.revert(ethers);

      expect(await token.delegates(voter1.address)).to.equal(voter1.address);
      expect(await token.getVotes(voter1.address)).to.equal(amount);
    });
  });

  // ── Immutability ─────────────────────────────────────────────────────
  describe("Immutability", () => {
    it("should not have a mint function", async () => {
      const { token } = await networkHelpers.loadFixture(deployDAOFixture);
      expect((token as any).mint).to.be.undefined;
    });

    it("should not have a burn function", async () => {
      const { token } = await networkHelpers.loadFixture(deployDAOFixture);
      expect((token as any).burn).to.be.undefined;
    });

    it("should not have a pause function", async () => {
      const { token } = await networkHelpers.loadFixture(deployDAOFixture);
      expect((token as any).pause).to.be.undefined;
    });

    it("should not have an owner function", async () => {
      const { token } = await networkHelpers.loadFixture(deployDAOFixture);
      expect((token as any).owner).to.be.undefined;
    });
  });
});
