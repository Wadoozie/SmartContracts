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

describe("Headquarters", () => {
  // ── Configuration ────────────────────────────────────────────────────
  describe("Configuration", () => {
    it("should have correct voting delay", async () => {
      const { governor } =
        await networkHelpers.loadFixture(deployDAOFixture);
      expect(await governor.votingDelay()).to.equal(TEST_PARAMS.VOTING_DELAY);
    });

    it("should have correct voting period", async () => {
      const { governor } =
        await networkHelpers.loadFixture(deployDAOFixture);
      expect(await governor.votingPeriod()).to.equal(
        TEST_PARAMS.VOTING_PERIOD,
      );
    });

    it("should have correct proposal threshold", async () => {
      const { governor } =
        await networkHelpers.loadFixture(deployDAOFixture);
      expect(await governor.proposalThreshold()).to.equal(
        TEST_PARAMS.PROPOSAL_THRESHOLD,
      );
    });

    it("should have correct quorum numerator", async () => {
      const { governor } =
        await networkHelpers.loadFixture(deployDAOFixture);
      expect(await governor["quorumNumerator()"]()).to.equal(
        TEST_PARAMS.QUORUM_PERCENT,
      );
    });

    it("should point to correct timelock", async () => {
      const { governor, timelock } =
        await networkHelpers.loadFixture(deployDAOFixture);
      expect(await governor.timelock()).to.equal(await timelock.getAddress());
    });

    it("should point to correct token", async () => {
      const { governor, token } =
        await networkHelpers.loadFixture(deployDAOFixture);
      expect(await governor.token()).to.equal(await token.getAddress());
    });
  });

  // ── Proposal Creation ───────────────────────────────────────────────
  describe("Proposal Creation", () => {
    it("should create a proposal and emit ProposalCreated", async () => {
      const { governor, token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      // Delegate so initialHolder has voting power (needed for snapshot)
      await delegateAndMine(token, initialHolder, initialHolder, networkHelpers);

      const targets = [voter1.address];
      const values = [0n];
      const calldatas = ["0x"];
      const description = "Test proposal";

      await expect(
        governor
          .connect(initialHolder)
          .propose(targets, values, calldatas, description),
      ).to.emit(governor, "ProposalCreated");
    });

    it("should reject proposal from account below threshold", async () => {
      const { governor, token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      // Give voter1 less than the threshold and delegate
      const belowThreshold = TEST_PARAMS.PROPOSAL_THRESHOLD - 1n;
      await token.connect(initialHolder).transfer(voter1.address, belowThreshold);
      await delegateAndMine(token, voter1, voter1, networkHelpers);

      await expect(
        governor
          .connect(voter1)
          .propose([voter1.address], [0n], ["0x"], "Should fail"),
      ).to.be.revertedWithCustomError(governor, "GovernorInsufficientProposerVotes");
    });

    it("should start proposal in Pending state", async () => {
      const { governor, token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      await delegateAndMine(token, initialHolder, initialHolder, networkHelpers);

      const { proposalId } = await propose(
        governor,
        initialHolder,
        [voter1.address],
        [0n],
        ["0x"],
        "Test proposal",
      );

      expect(await governor.state(proposalId)).to.equal(ProposalState.Pending);
    });
  });

  // ── Voting ──────────────────────────────────────────────────────────
  describe("Voting", () => {
    it("should accept For votes", async () => {
      const { governor, token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      // Distribute tokens and delegate
      const amount = ethers.parseEther("1000");
      await token.connect(initialHolder).transfer(voter1.address, amount);
      await delegateAndMine(token, voter1, voter1, networkHelpers);
      await delegateAndMine(token, initialHolder, initialHolder, networkHelpers);

      const { proposalId } = await propose(
        governor,
        initialHolder,
        [voter1.address],
        [0n],
        ["0x"],
        "Vote test",
      );

      // Mine past voting delay
      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_DELAY) + 1);

      await expect(governor.connect(voter1).castVote(proposalId, VoteType.For))
        .to.emit(governor, "VoteCast")
        .withArgs(voter1.address, proposalId, VoteType.For, amount, "");
    });

    it("should accept Against votes", async () => {
      const { governor, token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      const amount = ethers.parseEther("1000");
      await token.connect(initialHolder).transfer(voter1.address, amount);
      await delegateAndMine(token, voter1, voter1, networkHelpers);
      await delegateAndMine(token, initialHolder, initialHolder, networkHelpers);

      const { proposalId } = await propose(
        governor,
        initialHolder,
        [voter1.address],
        [0n],
        ["0x"],
        "Against test",
      );

      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_DELAY) + 1);

      await governor.connect(voter1).castVote(proposalId, VoteType.Against);

      const votes = await governor.proposalVotes(proposalId);
      expect(votes[0]).to.equal(amount); // againstVotes
    });

    it("should accept Abstain votes", async () => {
      const { governor, token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      const amount = ethers.parseEther("1000");
      await token.connect(initialHolder).transfer(voter1.address, amount);
      await delegateAndMine(token, voter1, voter1, networkHelpers);
      await delegateAndMine(token, initialHolder, initialHolder, networkHelpers);

      const { proposalId } = await propose(
        governor,
        initialHolder,
        [voter1.address],
        [0n],
        ["0x"],
        "Abstain test",
      );

      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_DELAY) + 1);

      await governor.connect(voter1).castVote(proposalId, VoteType.Abstain);

      const votes = await governor.proposalVotes(proposalId);
      expect(votes[2]).to.equal(amount); // abstainVotes
    });

    it("should prevent double voting", async () => {
      const { governor, token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      const amount = ethers.parseEther("1000");
      await token.connect(initialHolder).transfer(voter1.address, amount);
      await delegateAndMine(token, voter1, voter1, networkHelpers);
      await delegateAndMine(token, initialHolder, initialHolder, networkHelpers);

      const { proposalId } = await propose(
        governor,
        initialHolder,
        [voter1.address],
        [0n],
        ["0x"],
        "Double vote test",
      );

      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_DELAY) + 1);

      await governor.connect(voter1).castVote(proposalId, VoteType.For);

      await expect(
        governor.connect(voter1).castVote(proposalId, VoteType.For),
      ).to.be.revertedWithCustomError(governor, "GovernorAlreadyCastVote");
    });

    it("should use correct voting weight", async () => {
      const { governor, token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      const amount = ethers.parseEther("5000");
      await token.connect(initialHolder).transfer(voter1.address, amount);
      await delegateAndMine(token, voter1, voter1, networkHelpers);
      await delegateAndMine(token, initialHolder, initialHolder, networkHelpers);

      const { proposalId } = await propose(
        governor,
        initialHolder,
        [voter1.address],
        [0n],
        ["0x"],
        "Weight test",
      );

      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_DELAY) + 1);

      await governor.connect(voter1).castVote(proposalId, VoteType.For);

      const votes = await governor.proposalVotes(proposalId);
      expect(votes[1]).to.equal(amount); // forVotes
    });
  });

  // ── Cancellation (no guardian — base Governor behavior) ─────────────
  describe("Cancellation", () => {
    it("no proposal guardian is set", async () => {
      const { governor } =
        await networkHelpers.loadFixture(deployDAOFixture);
      // GovernorProposalGuardian is removed; proposalGuardian() should not exist
      expect(governor.proposalGuardian).to.be.undefined;
    });

    it("proposer can cancel own Pending proposal", async () => {
      const { governor, token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      await delegateAndMine(token, initialHolder, initialHolder, networkHelpers);

      const targets = [voter1.address];
      const values = [0n];
      const calldatas = ["0x"];
      const description = "Proposer cancel pending test";

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

      expect(await governor.state(proposalId)).to.equal(ProposalState.Canceled);
    });

    it("proposer cannot cancel own Active proposal", async () => {
      const { governor, token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      await delegateAndMine(token, initialHolder, initialHolder, networkHelpers);

      const targets = [voter1.address];
      const values = [0n];
      const calldatas = ["0x"];
      const description = "Proposer cancel active test";

      await propose(
        governor,
        initialHolder,
        targets,
        values,
        calldatas,
        description,
      );

      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_DELAY) + 1);

      const descriptionHash = ethers.keccak256(
        ethers.toUtf8Bytes(description),
      );
      await expect(
        governor
          .connect(initialHolder)
          .cancel(targets, values, calldatas, descriptionHash),
      ).to.be.revertedWithCustomError(governor, "GovernorUnableToCancel");
    });

    it("non-proposer cannot cancel other's proposal", async () => {
      const { governor, token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      await delegateAndMine(token, initialHolder, initialHolder, networkHelpers);

      const targets = [voter1.address];
      const values = [0n];
      const calldatas = ["0x"];
      const description = "Non-proposer cancel test";

      await propose(
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
      await expect(
        governor
          .connect(voter1)
          .cancel(targets, values, calldatas, descriptionHash),
      ).to.be.revertedWithCustomError(governor, "GovernorUnableToCancel");
    });
  });

  // ── Timelock Immutability ───────────────────────────────────────────
  describe("Timelock Immutability", () => {
    it("should revert updateTimelock even via governance", async () => {
      const { governor, token, initialHolder } =
        await networkHelpers.loadFixture(deployDAOFixture);

      await delegateAndMine(token, initialHolder, initialHolder, networkHelpers);

      const governorAddress = await governor.getAddress();
      // Encode a call to updateTimelock with an arbitrary address
      const calldata = governor.interface.encodeFunctionData(
        "updateTimelock",
        [initialHolder.address],
      );

      const targets = [governorAddress];
      const values = [0n];
      const calldatas = [calldata];
      const description = "Attempt timelock migration";

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

      // Execution should revert because updateTimelock always reverts
      await expect(
        governor.execute(targets, values, calldatas, descriptionHash),
      ).to.be.revertedWithCustomError(governor, "HeadquartersTimelockImmutable");
    });
  });

  // ── Proposal States ─────────────────────────────────────────────────
  describe("Proposal States", () => {
    it("should transition to Active after voting delay", async () => {
      const { governor, token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      await delegateAndMine(token, initialHolder, initialHolder, networkHelpers);

      const { proposalId } = await propose(
        governor,
        initialHolder,
        [voter1.address],
        [0n],
        ["0x"],
        "Active state test",
      );

      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_DELAY) + 1);
      expect(await governor.state(proposalId)).to.equal(ProposalState.Active);
    });

    it("should be Succeeded when quorum met with For majority", async () => {
      const { governor, token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      await delegateAndMine(token, initialHolder, initialHolder, networkHelpers);

      const { proposalId } = await propose(
        governor,
        initialHolder,
        [voter1.address],
        [0n],
        ["0x"],
        "Succeeded test",
      );

      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_DELAY) + 1);
      await governor
        .connect(initialHolder)
        .castVote(proposalId, VoteType.For);

      // Mine past voting period
      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_PERIOD) + 1);
      expect(await governor.state(proposalId)).to.equal(
        ProposalState.Succeeded,
      );
    });

    it("should be Defeated when quorum not met", async () => {
      const { governor, token, initialHolder, voter1, voter2 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      // Give voter2 a tiny amount (well below 4% quorum)
      const tinyAmount = ethers.parseEther("1");
      await token.connect(initialHolder).transfer(voter2.address, tinyAmount);
      await delegateAndMine(token, voter2, voter2, networkHelpers);
      await delegateAndMine(token, initialHolder, initialHolder, networkHelpers);

      const { proposalId } = await propose(
        governor,
        initialHolder,
        [voter1.address],
        [0n],
        ["0x"],
        "Defeated test",
      );

      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_DELAY) + 1);

      // Only voter2 votes (tiny amount, below quorum)
      await governor.connect(voter2).castVote(proposalId, VoteType.For);

      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_PERIOD) + 1);
      expect(await governor.state(proposalId)).to.equal(
        ProposalState.Defeated,
      );
    });

    it("should be Defeated when Against majority", async () => {
      const { governor, token, initialHolder, voter1 } =
        await networkHelpers.loadFixture(deployDAOFixture);

      await delegateAndMine(token, initialHolder, initialHolder, networkHelpers);

      const { proposalId } = await propose(
        governor,
        initialHolder,
        [voter1.address],
        [0n],
        ["0x"],
        "Against majority test",
      );

      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_DELAY) + 1);
      await governor
        .connect(initialHolder)
        .castVote(proposalId, VoteType.Against);

      await networkHelpers.mine(Number(TEST_PARAMS.VOTING_PERIOD) + 1);
      expect(await governor.state(proposalId)).to.equal(
        ProposalState.Defeated,
      );
    });
  });
});
