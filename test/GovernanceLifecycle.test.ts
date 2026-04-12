import { expect } from "chai";
import { network } from "hardhat";
import {
  deployDAOFixture,
  delegateAndMine,
  propose,
  TEST_PARAMS,
  VoteType,
  ProposalState,
} from "./helpers.js";

const connection = await network.connect();
const { ethers, networkHelpers } = connection;

describe("GovernanceLifecycle", () => {
  // ── Full Lifecycle: Propose → Vote → Queue → Wait → Execute ─────────
  describe("Full Lifecycle", () => {
    it("should complete full proposal lifecycle (propose → vote → queue → execute)", async () => {
      const { governor, token, timelock, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      await delegateAndMine(
        token,
        initialHolder,
        initialHolder,
        networkHelpers,
      );

      // Proposal: send 1 ETH from timelock to voter1
      const timelockAddress = await timelock.getAddress();
      await initialHolder.sendTransaction({
        to: timelockAddress,
        value: ethers.parseEther("1"),
      });

      const targets = [voter1.address];
      const values = [ethers.parseEther("1")];
      const calldatas = ["0x"];
      const description = "Send 1 ETH to voter1";

      // 1. Propose
      const { proposalId } = await propose(
        governor,
        initialHolder,
        targets,
        values,
        calldatas,
        description,
      );
      expect(await governor.state(proposalId)).to.equal(ProposalState.Pending);

      // 2. Mine past voting delay → Active
      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_DELAY) + 1);
      expect(await governor.state(proposalId)).to.equal(ProposalState.Active);

      // 3. Vote
      await governor
        .connect(initialHolder)
        .castVote(proposalId, VoteType.For);

      // 4. Mine past voting period → Succeeded
      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_PERIOD) + 1);
      expect(await governor.state(proposalId)).to.equal(
        ProposalState.Succeeded,
      );

      // 5. Queue
      const descriptionHash = ethers.keccak256(
        ethers.toUtf8Bytes(description),
      );
      await governor.queue(targets, values, calldatas, descriptionHash);
      expect(await governor.state(proposalId)).to.equal(ProposalState.Queued);

      // 6. Wait for timelock delay
      await networkHelpers.time.increase(TEST_PARAMS.TIMELOCK_DELAY + 1);

      // 7. Execute
      const balanceBefore = await ethers.provider.getBalance(voter1.address);
      await governor.execute(targets, values, calldatas, descriptionHash);
      expect(await governor.state(proposalId)).to.equal(
        ProposalState.Executed,
      );

      const balanceAfter = await ethers.provider.getBalance(voter1.address);
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("1"));
    });
  });

  // ── Timelock ────────────────────────────────────────────────────────
  describe("Timelock", () => {
    it("should not allow execution before timelock delay", async () => {
      const { governor, token, timelock, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      await delegateAndMine(
        token,
        initialHolder,
        initialHolder,
        networkHelpers,
      );

      const timelockAddress = await timelock.getAddress();
      await initialHolder.sendTransaction({
        to: timelockAddress,
        value: ethers.parseEther("1"),
      });

      const targets = [voter1.address];
      const values = [ethers.parseEther("1")];
      const calldatas = ["0x"];
      const description = "Timelock delay test";

      const { proposalId } = await propose(
        governor,
        initialHolder,
        targets,
        values,
        calldatas,
        description,
      );

      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_DELAY) + 1);
      await governor
        .connect(initialHolder)
        .castVote(proposalId, VoteType.For);
      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_PERIOD) + 1);

      const descriptionHash = ethers.keccak256(
        ethers.toUtf8Bytes(description),
      );
      await governor.queue(targets, values, calldatas, descriptionHash);

      // Try to execute immediately — should fail
      await expect(
        governor.execute(targets, values, calldatas, descriptionHash),
      ).to.be.revert(ethers);
    });

    it("should execute after timelock delay", async () => {
      const { governor, token, timelock, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      await delegateAndMine(
        token,
        initialHolder,
        initialHolder,
        networkHelpers,
      );

      const timelockAddress = await timelock.getAddress();
      await initialHolder.sendTransaction({
        to: timelockAddress,
        value: ethers.parseEther("1"),
      });

      const targets = [voter1.address];
      const values = [ethers.parseEther("1")];
      const calldatas = ["0x"];
      const description = "Execute after delay test";

      const { proposalId } = await propose(
        governor,
        initialHolder,
        targets,
        values,
        calldatas,
        description,
      );

      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_DELAY) + 1);
      await governor
        .connect(initialHolder)
        .castVote(proposalId, VoteType.For);
      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_PERIOD) + 1);

      const descriptionHash = ethers.keccak256(
        ethers.toUtf8Bytes(description),
      );
      await governor.queue(targets, values, calldatas, descriptionHash);

      // Wait for timelock delay
      await networkHelpers.time.increase(TEST_PARAMS.TIMELOCK_DELAY + 1);

      // Now it should succeed
      await expect(
        governor.execute(targets, values, calldatas, descriptionHash),
      ).to.not.be.revert(ethers);
    });
  });

  // ── Cancellation ────────────────────────────────────────────────────
  describe("Cancellation", () => {
    it("should allow proposer to cancel a proposal", async () => {
      const { governor, token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      await delegateAndMine(
        token,
        initialHolder,
        initialHolder,
        networkHelpers,
      );

      const targets = [voter1.address];
      const values = [0n];
      const calldatas = ["0x"];
      const description = "Cancel test";

      const { proposalId } = await propose(
        governor,
        initialHolder,
        targets,
        values,
        calldatas,
        description,
      );

      const descriptionHash = ethers.keccak256(
        ethers.toUtf8Bytes(description),
      );
      await governor
        .connect(initialHolder)
        .cancel(targets, values, calldatas, descriptionHash);

      expect(await governor.state(proposalId)).to.equal(
        ProposalState.Canceled,
      );
    });
  });

  // ── Access Control ──────────────────────────────────────────────────
  describe("Access Control", () => {
    it("should not allow deployer to have admin role on timelock", async () => {
      const { timelock, deployer } =
        await networkHelpers.loadFixture(deployDAOFixture);

      const DEFAULT_ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();
      expect(
        await timelock.hasRole(DEFAULT_ADMIN_ROLE, deployer.address),
      ).to.be.false;
    });

    it("should have governor as proposer on timelock", async () => {
      const { timelock, governor } =
        await networkHelpers.loadFixture(deployDAOFixture);

      const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
      expect(
        await timelock.hasRole(PROPOSER_ROLE, await governor.getAddress()),
      ).to.be.true;
    });

    it("should have governor as canceller on timelock", async () => {
      const { timelock, governor } =
        await networkHelpers.loadFixture(deployDAOFixture);

      const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
      expect(
        await timelock.hasRole(CANCELLER_ROLE, await governor.getAddress()),
      ).to.be.true;
    });

    it("should allow anyone to execute on timelock", async () => {
      const { timelock } =
        await networkHelpers.loadFixture(deployDAOFixture);

      const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
      expect(
        await timelock.hasRole(EXECUTOR_ROLE, ethers.ZeroAddress),
      ).to.be.true;
    });

    it("should not allow deployer to directly schedule on timelock", async () => {
      const { timelock, deployer, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      await expect(
        timelock
          .connect(deployer)
          .schedule(
            voter1.address,
            0,
            "0x",
            ethers.ZeroHash,
            ethers.ZeroHash,
            TEST_PARAMS.TIMELOCK_DELAY,
          ),
      ).to.be.revert(ethers);
    });
  });

  // ── ETH Handling ────────────────────────────────────────────────────
  describe("ETH Handling", () => {
    it("should allow timelock to receive ETH", async () => {
      const { timelock, initialHolder } =
        await networkHelpers.loadFixture(deployDAOFixture);

      const timelockAddress = await timelock.getAddress();
      const amount = ethers.parseEther("5");

      await initialHolder.sendTransaction({
        to: timelockAddress,
        value: amount,
      });

      expect(await ethers.provider.getBalance(timelockAddress)).to.equal(
        amount,
      );
    });

    it("should send ETH via governance proposal", async () => {
      const { governor, token, timelock, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      await delegateAndMine(
        token,
        initialHolder,
        initialHolder,
        networkHelpers,
      );

      // Fund timelock
      const timelockAddress = await timelock.getAddress();
      const amount = ethers.parseEther("2");
      await initialHolder.sendTransaction({
        to: timelockAddress,
        value: amount,
      });

      const targets = [voter1.address];
      const values = [amount];
      const calldatas = ["0x"];
      const description = "ETH transfer proposal";

      const { proposalId } = await propose(
        governor,
        initialHolder,
        targets,
        values,
        calldatas,
        description,
      );

      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_DELAY) + 1);
      await governor
        .connect(initialHolder)
        .castVote(proposalId, VoteType.For);
      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_PERIOD) + 1);

      const descriptionHash = ethers.keccak256(
        ethers.toUtf8Bytes(description),
      );
      await governor.queue(targets, values, calldatas, descriptionHash);
      await networkHelpers.time.increase(TEST_PARAMS.TIMELOCK_DELAY + 1);

      const balanceBefore = await ethers.provider.getBalance(voter1.address);
      await governor.execute(targets, values, calldatas, descriptionHash);
      const balanceAfter = await ethers.provider.getBalance(voter1.address);

      expect(balanceAfter - balanceBefore).to.equal(amount);
    });
  });

  // ── Self-Modification ───────────────────────────────────────────────
  describe("Self-Modification", () => {
    it("should update voting delay via governance", async () => {
      const { governor, token, timelock, initialHolder } =
        await networkHelpers.loadFixture(deployDAOFixture);

      await delegateAndMine(
        token,
        initialHolder,
        initialHolder,
        networkHelpers,
      );

      const governorAddress = await governor.getAddress();
      const newDelay = 20n;

      // Encode setVotingDelay call
      const calldata = governor.interface.encodeFunctionData(
        "setVotingDelay",
        [newDelay],
      );

      const targets = [governorAddress];
      const values = [0n];
      const calldatas = [calldata];
      const description = "Update voting delay to 20";

      const { proposalId } = await propose(
        governor,
        initialHolder,
        targets,
        values,
        calldatas,
        description,
      );

      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_DELAY) + 1);
      await governor
        .connect(initialHolder)
        .castVote(proposalId, VoteType.For);
      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_PERIOD) + 1);

      const descriptionHash = ethers.keccak256(
        ethers.toUtf8Bytes(description),
      );
      await governor.queue(targets, values, calldatas, descriptionHash);
      await networkHelpers.time.increase(TEST_PARAMS.TIMELOCK_DELAY + 1);

      await governor.execute(targets, values, calldatas, descriptionHash);

      expect(await governor.votingDelay()).to.equal(newDelay);
    });

    it("should update voting period via governance", async () => {
      const { governor, token, timelock, initialHolder } =
        await networkHelpers.loadFixture(deployDAOFixture);

      await delegateAndMine(
        token,
        initialHolder,
        initialHolder,
        networkHelpers,
      );

      const governorAddress = await governor.getAddress();
      const newPeriod = 100n;

      const calldata = governor.interface.encodeFunctionData(
        "setVotingPeriod",
        [newPeriod],
      );

      const targets = [governorAddress];
      const values = [0n];
      const calldatas = [calldata];
      const description = "Update voting period to 100";

      const { proposalId } = await propose(
        governor,
        initialHolder,
        targets,
        values,
        calldatas,
        description,
      );

      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_DELAY) + 1);
      await governor
        .connect(initialHolder)
        .castVote(proposalId, VoteType.For);
      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_PERIOD) + 1);

      const descriptionHash = ethers.keccak256(
        ethers.toUtf8Bytes(description),
      );
      await governor.queue(targets, values, calldatas, descriptionHash);
      await networkHelpers.time.increase(TEST_PARAMS.TIMELOCK_DELAY + 1);

      await governor.execute(targets, values, calldatas, descriptionHash);

      expect(await governor.votingPeriod()).to.equal(newPeriod);
    });
  });
});
