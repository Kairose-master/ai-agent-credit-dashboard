// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * GovernancePoll — a minimal commit-reveal poll registry for Ledgermind
 * governance, modeled on the algorithmica-agent-dashboard VeilPoll.
 *
 * Why commit-reveal: votes are hidden during the commit window (you only
 * publish keccak256(option, salt, voter)), then revealed after it closes.
 * Nobody — not even the platform relayer — can see how you voted until the
 * reveal phase, so an on-chain vote can't be front-run, bought, or
 * pressured based on the running tally.
 *
 * One registry contract holds many polls (one per off-chain proposal), so
 * governance needs a single deploy. Votes here are one-address-one-choice;
 * Ledgermind applies ve-weight OFF-CHAIN by joining a revealed choice with
 * the voter's locked $LEDGER — this contract is the tamper-evident record
 * of the CHOICE, not the weight.
 *
 * Voters are agent smart accounts (ERC-4337). msg.sender is that account.
 */
contract GovernancePoll {
    struct Poll {
        uint8 numOptions;
        uint64 commitEnd; // unix seconds — commits accepted up to here
        uint64 revealEnd; // reveals accepted (commitEnd, revealEnd]
        bool exists;
        uint256[] tally; // length numOptions, filled during reveal
    }

    uint256 public pollCount;
    mapping(uint256 => Poll) private polls;
    mapping(uint256 => mapping(address => bytes32)) public commitmentOf;
    mapping(uint256 => mapping(address => bool)) public hasRevealed;

    event PollCreated(uint256 indexed pollId, uint8 numOptions, uint64 commitEnd, uint64 revealEnd);
    event Committed(uint256 indexed pollId, address indexed voter);
    event Revealed(uint256 indexed pollId, address indexed voter, uint8 option);

    /**
     * Create a poll. Open to any caller so the platform relayer can mirror a
     * proposal without being a privileged owner — a poll only ever records
     * commit-reveal votes, it moves no value, so there's nothing to gate.
     */
    function createPoll(uint8 numOptions, uint64 commitEnd, uint64 revealEnd) external returns (uint256 pollId) {
        require(numOptions >= 2 && numOptions <= 8, "bad options");
        require(commitEnd > block.timestamp, "commit end in past");
        require(revealEnd > commitEnd, "reveal before commit end");
        pollId = ++pollCount;
        Poll storage p = polls[pollId];
        p.numOptions = numOptions;
        p.commitEnd = commitEnd;
        p.revealEnd = revealEnd;
        p.exists = true;
        p.tally = new uint256[](numOptions);
        emit PollCreated(pollId, numOptions, commitEnd, revealEnd);
    }

    /** Commit a hidden vote: commitment = keccak256(abi.encodePacked(uint256(option), salt, msg.sender)). */
    function commitVote(uint256 pollId, bytes32 commitment) external {
        Poll storage p = polls[pollId];
        require(p.exists, "no poll");
        require(block.timestamp <= p.commitEnd, "commit closed");
        require(commitmentOf[pollId][msg.sender] == bytes32(0), "already committed");
        require(commitment != bytes32(0), "empty commitment");
        commitmentOf[pollId][msg.sender] = commitment;
        emit Committed(pollId, msg.sender);
    }

    /** Reveal a committed vote during the reveal window. Verifies the salt. */
    function revealVote(uint256 pollId, uint8 option, bytes32 salt) external {
        Poll storage p = polls[pollId];
        require(p.exists, "no poll");
        require(block.timestamp > p.commitEnd && block.timestamp <= p.revealEnd, "not reveal phase");
        require(!hasRevealed[pollId][msg.sender], "already revealed");
        require(option < p.numOptions, "bad option");
        bytes32 expected = keccak256(abi.encodePacked(uint256(option), salt, msg.sender));
        require(commitmentOf[pollId][msg.sender] == expected, "reveal mismatch");
        hasRevealed[pollId][msg.sender] = true;
        p.tally[option] += 1;
        emit Revealed(pollId, msg.sender, option);
    }

    /** 0 = commit phase, 1 = reveal phase, 2 = closed, 255 = no such poll. */
    function phase(uint256 pollId) external view returns (uint8) {
        Poll storage p = polls[pollId];
        if (!p.exists) return 255;
        if (block.timestamp <= p.commitEnd) return 0;
        if (block.timestamp <= p.revealEnd) return 1;
        return 2;
    }

    function results(uint256 pollId) external view returns (uint256[] memory) {
        return polls[pollId].tally;
    }

    function pollInfo(uint256 pollId)
        external
        view
        returns (uint8 numOptions, uint64 commitEnd, uint64 revealEnd, bool exists)
    {
        Poll storage p = polls[pollId];
        return (p.numOptions, p.commitEnd, p.revealEnd, p.exists);
    }
}
