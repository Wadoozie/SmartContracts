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

    it("should have correct total supply", async () => {
      const { token } = await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.totalSupply()).to.equal(TEST_PARAMS.TOTAL_SUPPLY);
    });

    it("should assign entire supply to initial holder", async () => {
      const { token, initialHolder } =
        await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.balanceOf(initialHolder.address)).to.equal(
        TEST_PARAMS.TOTAL_SUPPLY,
      );
    });

    it("should have 18 decimals", async () => {
      const { token } = await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.decimals()).to.equal(18n);
    });
  });

  // ── Transfers ────────────────────────────────────────────────────────
  describe("Transfers", () => {
    it("should transfer tokens between accounts", async () => {
      const { token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("1000");

      await expect(
        token.connect(initialHolder).transfer(voter1.address, amount),
      )
        .to.emit(token, "Transfer")
        .withArgs(initialHolder.address, voter1.address, amount);

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
      const { token, initialHolder, voter1, voter2 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount1 = ethers.parseEther("100");
      const amount2 = ethers.parseEther("50");

      await token.connect(initialHolder).transfer(voter1.address, amount1);
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
      const { token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("500");
      const nonce = await token.nonces(initialHolder.address);
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
        owner: initialHolder.address,
        spender: voter1.address,
        value: amount,
        nonce,
        deadline,
      };

      const sig = await initialHolder.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(sig);

      await token.permit(
        initialHolder.address,
        voter1.address,
        amount,
        deadline,
        v,
        r,
        s,
      );

      expect(
        await token.allowance(initialHolder.address, voter1.address),
      ).to.equal(amount);
    });

    it("should reject expired permit", async () => {
      const { token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("500");
      const nonce = await token.nonces(initialHolder.address);
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
        owner: initialHolder.address,
        spender: voter1.address,
        value: amount,
        nonce,
        deadline,
      };

      const sig = await initialHolder.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(sig);

      await expect(
        token.permit(
          initialHolder.address,
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
      const { token, initialHolder, voter1, voter2 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("500");
      const nonce = await token.nonces(initialHolder.address);
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
        owner: initialHolder.address,
        spender: voter1.address,
        value: amount,
        nonce,
        deadline,
      };

      // voter2 signs instead of initialHolder
      const sig = await voter2.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(sig);

      await expect(
        token.permit(
          initialHolder.address,
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
    it("should have zero voting power before delegation", async () => {
      const { token, initialHolder } =
        await networkHelpers.loadFixture(deployDAOFixture);
      expect(await token.getVotes(initialHolder.address)).to.equal(0n);
    });

    it("should grant voting power after self-delegation", async () => {
      const { token, initialHolder } =
        await networkHelpers.loadFixture(deployDAOFixture);
      await token.connect(initialHolder).delegate(initialHolder.address);
      expect(await token.getVotes(initialHolder.address)).to.equal(
        TEST_PARAMS.TOTAL_SUPPLY,
      );
    });

    it("should delegate voting power to another account", async () => {
      const { token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      await token.connect(initialHolder).delegate(voter1.address);
      expect(await token.getVotes(voter1.address)).to.equal(
        TEST_PARAMS.TOTAL_SUPPLY,
      );
      expect(await token.getVotes(initialHolder.address)).to.equal(0n);
    });

    it("should update voting power on transfer", async () => {
      const { token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("1000");

      // Both delegate to themselves
      await token.connect(initialHolder).delegate(initialHolder.address);
      await token.connect(voter1).delegate(voter1.address);

      await token.connect(initialHolder).transfer(voter1.address, amount);

      expect(await token.getVotes(voter1.address)).to.equal(amount);
      expect(await token.getVotes(initialHolder.address)).to.equal(
        TEST_PARAMS.TOTAL_SUPPLY - amount,
      );
    });

    it("should checkpoint past votes", async () => {
      const { token, initialHolder } =
        await networkHelpers.loadFixture(deployDAOFixture);
      await token.connect(initialHolder).delegate(initialHolder.address);

      const blockBefore = await ethers.provider.getBlockNumber();
      await networkHelpers.mine(1);

      expect(
        await token.getPastVotes(initialHolder.address, blockBefore),
      ).to.equal(TEST_PARAMS.TOTAL_SUPPLY);
    });
  });

  // ── Auto-Delegation (WAD-04) ─────────────────────────────────────────
  describe("Auto-Delegation (WAD-04)", () => {
    it("initial holder is not auto-delegated on mint", async () => {
      const { token, initialHolder } =
        await networkHelpers.loadFixture(deployDAOFixture);

      expect(await token.delegates(initialHolder.address)).to.equal(
        ethers.ZeroAddress,
      );
      expect(await token.getVotes(initialHolder.address)).to.equal(0n);
    });

    it("recipient is auto-self-delegated on first transfer", async () => {
      const { token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("1000");

      expect(await token.delegates(voter1.address)).to.equal(
        ethers.ZeroAddress,
      );

      await expect(
        token.connect(initialHolder).transfer(voter1.address, amount),
      )
        .to.emit(token, "DelegateChanged")
        .withArgs(voter1.address, ethers.ZeroAddress, voter1.address);

      expect(await token.delegates(voter1.address)).to.equal(voter1.address);
      expect(await token.getVotes(voter1.address)).to.equal(amount);
    });

    it("does not override an existing delegation", async () => {
      const { token, initialHolder, voter1, voter2 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("1000");

      // voter1 delegates to voter2 before ever holding tokens.
      await token.connect(voter1).delegate(voter2.address);
      expect(await token.delegates(voter1.address)).to.equal(voter2.address);

      await token.connect(initialHolder).transfer(voter1.address, amount);

      expect(await token.delegates(voter1.address)).to.equal(voter2.address);
      expect(await token.getVotes(voter2.address)).to.equal(amount);
      expect(await token.getVotes(voter1.address)).to.equal(0n);
    });

    it("second transfer to same recipient does not re-delegate", async () => {
      const { token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("500");

      await expect(
        token.connect(initialHolder).transfer(voter1.address, amount),
      ).to.emit(token, "DelegateChanged");

      await expect(
        token.connect(initialHolder).transfer(voter1.address, amount),
      ).to.not.emit(token, "DelegateChanged");

      expect(await token.delegates(voter1.address)).to.equal(voter1.address);
      expect(await token.getVotes(voter1.address)).to.equal(amount * 2n);
    });

    it("self-transfer does not fail when already delegated", async () => {
      const { token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);
      const amount = ethers.parseEther("100");

      // First transfer triggers auto-delegation.
      await token.connect(initialHolder).transfer(voter1.address, amount);
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
