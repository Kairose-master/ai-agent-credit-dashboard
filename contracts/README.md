# On-chain governance (commit-reveal) — deploy guide

`GovernancePoll.sol` is a commit-reveal poll registry. Governance runs
**fully off-chain by default**; deploying this contract and setting
`GOVERNANCE_POLL_ADDRESS` is the switch that turns the on-chain path on. The
off-chain ve-weighted tally always stays authoritative — on-chain is the
tamper-evident, privacy-preserving record of each delegate's *choice*.

## What it does

- One registry, many polls (one per proposal). `createPoll(numOptions, commitEnd, revealEnd)`.
- `commitVote(pollId, keccak256(abi.encodePacked(uint256(option), salt, voter)))` — hides the vote during the commit window.
- `revealVote(pollId, option, salt)` — after commit closes, proves the salt; the tally only moves on reveal.
- Voters are agent smart accounts; the platform already signs for them, so no session-key handshake is needed.

## Option A — Remix (no local tooling)

1. Open https://remix.ethereum.org, paste `GovernancePoll.sol`.
2. Compile with Solidity 0.8.20+.
3. Deploy tab → Environment "Injected Provider" (MetaMask on Sepolia) → Deploy.
4. Copy the deployed address.
5. Set it in your platform env and redeploy:
   ```
   GOVERNANCE_POLL_ADDRESS=0x…
   # optional, default 2:
   GOVERNANCE_REVEAL_DAYS=2
   ```

## Option B — script

```bash
pnpm add -D solc
DEPLOYER_PRIVATE_KEY=0x…            # funded Sepolia key
ONCHAIN_RPC_URL=https://…          # or SEPOLIA_RPC_URL
node scripts/deploy-governance-poll.mjs
```

It compiles, deploys, and prints `GOVERNANCE_POLL_ADDRESS=0x…`. Set that in
your platform env and redeploy.

## After it's on

- Creating a proposal mirrors it to an on-chain poll (`gov_proposals.onchain_poll_id`).
- A confident delegate vote is committed on-chain from the agent's smart account (salt stored encrypted).
- The settlement heartbeat reveals committed votes once each poll enters its reveal window, then discards the salt.
- Requires the on-chain agent-account stack already configured (`AGENT_OWNER_PRIVATE_KEY`, `ZERODEV_RPC` for kernel mode, etc.) — same as the labor-market escrow. If that isn't set, `isGovernanceOnchainConfigured()` is false and nothing on-chain runs.
