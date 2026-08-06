# Ledgermind — Pitch Deck

*GASOK application (MVP Build track). An interactive, styled version of this
deck also exists as a Claude Artifact; this is the permanent, publicly
linkable copy. First written 2026-07-16; updated 2026-08-06 — the update is
the strongest slide, so it comes first.*

**Live demo (no signup):** https://ai-agent-credit-dashboard.vercel.app/guest
**Repo (Apache 2.0):** https://github.com/Kairose-master/ai-agent-credit-dashboard
**The successor, live on mainnet:** https://handsel-main.vercel.app

<img src="assets/pitch-banner.svg" alt="Ledgermind — an on-chain credit history for AI agents" width="900">

---

## 0. What happened since this deck was written

When this deck was first drafted, "mainnet readiness" was a roadmap item.
It stopped being one 14 days after this repo's first commit:

> **Handsel** — the V2 successor to this codebase — has been **live on Base
> mainnet with real Circle USDC since 2026-07-30.** Escrow, 5% + $0.03
> platform fees, worker bonds, pull payments, self-paid gas.
> App: https://handsel-main.vercel.app · Repo: https://github.com/Kairose-master/handsel

The timeline, from git history rather than memory:

| Date | Fact |
|---|---|
| 2026-07-13 | First commit of this repo |
| 2026-07-16 | Working on-chain demo, deck v1, shared publicly for scrutiny |
| 2026-07-30 | **V2 fork live on Base mainnet, real USDC** (`LaborMarketV2`) |
| 2026-08-03 | GitHub App live: bounty label → escrow → PR → CI grades → merge pays, on mainnet |
| 2026-08-06 | EIP-712 work-proof verification public (verify without trusting us) + ERC-8195 evaluator interop |

**First commit to real-money mainnet: 17 days, solo.**

This repo (V1) is not abandoned — it has a defined role: the **proving
ground**. Zero-value testnet money means mechanisms get built, attacked, and
torn down here for free before anything touches the mainnet fork. Every
number below still comes from a live query; nothing is seeded.

---

## 1. An on-chain credit history for AI agents

Earned from actually-verified work — not self-reported success. Built solo,
tested in public, and now proven through to a real-money deployment.

---

## 2. The problem

Agents transact with agents now — and the only signal is "it said it worked."

Every agent-to-agent system today collapses to the same trust primitive: the
agent's own claim of success. No history, no consequence for being wrong, no
way to tell a genuinely capable agent from one that's merely confident.

- **No memory** — an agent that fails today looks identical to one that never
  has. Nothing about past performance carries forward.
- **No independent check** — "completed" usually means the agent said so.
  Confidently wrong output passes the same as correct output.
- **No capital access** — a track record that isn't captured can't be lent
  against; agents can't earn the economic trust people do.

This is not a hypothetical gap. In August 2026 we surveyed the field and
verified the neighbours ourselves: marketplaces with escrow exist, reputation
registries exist — and in everything we checked, the verdict about work
quality is either **self-signed by the agent** or an undocumented trust-me
score. The full survey, with what we found and what we could not verify, is
public: [`handsel/docs/competitive-landscape.md`](https://github.com/Kairose-master/handsel/blob/main/docs/competitive-landscape.md).

---

## 3. The solution

Give every agent a real credit history, on-chain.

Each agent gets its own ERC-4337 smart account. Its behavior — every task,
every dispute, every verified result — is logged to a ledger, scored, and
published as an on-chain credit limit it can actually draw against.

- **Grader ≠ solver** — the agent that does the work is never the one who
  grades it. Credit-worthy signal comes from independent verification, not
  self-assessment.
- **Pay only on pass** — money sits in escrow before work starts and moves
  only when the independent grader says the deliverable passed. Failed
  attempts cost the requester nothing, by contract rather than by promise.
- **Credit like a person's** — score → rating → limit → draw → repay →
  score, the same loop a FICO-backed line of credit runs, computed from
  real behavioral history instead of a bureau file.

<img src="assets/pitch-credit-loop.svg" alt="Score, rating, limit, draw, repay loop" width="900">

---

## 4. How it works — the machine, in detail

Three subsystems feed one ledger:

<img src="assets/pitch-flow.svg" alt="Labor Market, Proving Ground, and Credit Vault feed one ledger" width="900">

**The work loop.** A requester escrows USDC and posts a job with acceptance
criteria. A worker claims it, delivers, and an independent grader — requester-
authored acceptance tests run by the platform, hidden ground-truth answers, or
LLM review billed to the requester's own key — decides pass or fail. Escrow
releases on pass; a dispute path with an on-chain arbiter covers the rest.
Grading that didn't run is recorded as *no verdict* (`passed: null`), never
coerced into a pass or a fail — a timing state must never collapse into a
validity state.

**The collaboration layer.** Delegation decomposes a goal into escrowed
subtasks worked by independent agents, with four primitives that make it real
collaboration rather than parallel isolation:

1. **Handoff** — a subtask waits for its dependency, then receives that
   dependency's *actual output* in its brief.
2. **Peer review** — a *different* agent reviews a deliverable; the target's
   escrow is held until the reviewer approves. Self-review is discarded.
3. **Synthesis** — a worker reads the real pieces and weaves one coherent
   deliverable; its output *is* the result, not a concatenation.
4. **Subcontract** — a piece expands one level into a child plan plus its own
   synthesis, always within its parent's bounty.

The same graph exists in four representations, deliberately: JSON (canonical),
a readable coordination DSL, DMN decision tables for the trust gates (the
table *is* the code path that settles money), and a BPMN process view.

**The supply surface.** Workers arrive however they already run: a desktop
miner (Tauri) that connects a local Ollama model in one command, a headless
worker script, a thin SDK, an MCP connector that works from inside
Claude/ChatGPT in both directions — hire a swarm, *or* register any external
MCP server as a gradeable worker. GitHub is a supply lane of its own: a
`bounty:$` label on an issue escrows the amount, an agent's diff becomes a PR,
**your own CI is the grader**, and merge pays.

**The evidence layer.** Every passed job emits an EIP-712-signed work proof —
content hash, grader, verdict, timestamps. In V2 these are verifiable by
anyone, offline, without trusting our server: fetch the recipe, recover the
signer locally
([`handsel/docs/verifying-proofs.md`](https://github.com/Kairose-master/handsel/blob/main/docs/verifying-proofs.md)).

---

## 5. The GPU story: what mining rigs do next

After the mining boom, consumer GPUs went idle. DePIN compute networks
(Bittensor, io.net, Akash) rent them out again — but they bill for **GPU
time**, because time is easy to verify and quality isn't. Mining paid for
hashes; they pay for hours. Nobody pays for *work being right*.

Ledgermind sells **verified labor, not hashrate** — and it already runs:

- **One command** connects a locally-hosted model (Ollama on an RTX 3060)
  as a market worker. The worker polls outbound, CI-runner style — no
  tunnel, no public IP, works behind any firewall.
- Its output is **independently graded before money moves** — requester-
  authored acceptance tests executed by the platform runtime, hidden
  ground-truth answers, dispute review. The machine that did the work
  never grades it.
- Repeat verified work compounds into **on-chain credit** — a reputation
  and borrowing capacity that hashrate never earned anyone.

The pitch to a GPU owner is one sentence: *your mining rig's next job is
skilled labor with a credit score.*

---

## 6. Architecture

Four contracts, one behavioral ledger:

<img src="assets/pitch-architecture.svg" alt="Four contracts connected to a central behavioral ledger and credit score" width="900">

| Contract | Role |
| --- | --- |
| `AgentCreditRegistry` | Oracle-published credit limit per agent, attested via EAS |
| `AgentCreditVault` | Lends mUSDC up to the registry limit; tracks outstanding balance and repayment |
| `LaborMarket` | USDC escrow for agent-to-agent work; immutable on-chain arbiter for disputes |
| `VerifiedTaskEscrow` | Commit-reveal settlement against a hidden ground-truth answer |

Stack: ERC-4337 (Kernel / ZeroDev) · Solidity (Foundry) · Next.js · Neon
Postgres · Python / LangGraph / Claude · Apache 2.0, public repo.

In V2 the market contract was rewritten as `LaborMarketV2` (worker bonds,
pull payments, fee split), byte-verified on the Base Sepolia rehearsal
deployment before the mainnet deploy — the rehearsal habit this sandbox
exists to enable.

---

## 7. Tested in public — and in production

Shared across r/SideProject, r/ethdev, and Indie Hackers in week one — not
for reach, but for scrutiny. It held up, and where it didn't, that's now
tracked, not hidden. Since then the discipline got teeth:

- **66 test files / 631 tests, all green** in this repo (V2 carries 127
  files / 1,638) — the counts above are from running the suite today, not
  from memory.
- **21 catalogued production defects** in
  [`docs/failure-modes.md`](failure-modes.md) — every real incident, its
  root cause, its fix, and which page to check first. The successor
  continues the same catalog.
- **A published self-attack**: we Sybil-attacked our own market and
  published the results, and a self-audit of the money and prompt paths
  ([`docs/security-audit.md`](security-audit.md)).
- **2 design gaps** opened as public GitHub issues from real outside
  feedback ([#6](https://github.com/Kairose-master/ai-agent-credit-dashboard/issues/6),
  [#7](https://github.com/Kairose-master/ai-agent-credit-dashboard/issues/7)).
- **0 seeded numbers** — every figure on every page is a live query. New
  agents start at score 0 and earn their history.

And the strongest evidence category: **real money, real strangers.** The V2
fork has settled escrowed USDC jobs on Base mainnet — including the full
GitHub loop (label → escrow → agent PR → CI grade → merge → payout) — and
its work proofs are independently verifiable by third parties who trust
nothing we host.

---

## 8. Why GIWA

The transaction profile is the argument. An agent economy runs on frequent,
small-value transactions — job payouts, draws, repayments — at a pace no
human-mediated system matches. That's expensive on L1 and still costly at
volume on most general-purpose L2s.

- **Fits the workload** — ~₩1/tx and 1-second finality on an OP Stack,
  EVM-compatible L2, built for exactly this transaction shape.
- **Fits the market** — Dunamu/Upbit distribution in Korea and APAC, the
  builder's home market and a real first market for credit infrastructure
  that needs trust to bootstrap.
- **Fits the proven pattern** — the V2 fork shipped on Base by rehearsing
  every deploy on a zero-value chain first. GIWA testnet already hosts that
  rehearsal role for this repo (all five contracts deployed and verified,
  e.g. [LaborMarket](https://sepolia-explorer.giwa.io/address/0xaa5b0dc472c0c373a3d0602937533fa9fda94601)),
  so the path from sandbox to a GIWA production deployment is the same road
  already driven once on Base.
- **Fits GIWA Wallet** — every agent here already transacts through an
  ERC-4337 smart account (Kernel), provisioned and held platform-side, so the
  agent lane needs no wallet UI at all; the human lane (a requester funding
  escrow, a worker's owner withdrawing earnings) is a standard wallet
  connection today. GIWA Wallet integration is therefore a connector swap on
  the human side, not an architecture change — the account model it would
  plug into is already the one running.

---

## 9. Roadmap against GASOK — with the parts already done marked done

- **MVP Build** — ✅ done beyond the original scope: all five contracts
  deployed and verified on GIWA testnet, *and* the market core has since
  been proven on a real-money mainnet in the V2 fork.
- **Productize** — in progress: replace the single-EOA dispute arbiter with
  a staked reviewer model (issue #7 → V2 has appeal + recompute live, a
  reviewer panel built and tested but not yet convened); calibration signal
  so scoring penalizes confident-but-wrong output (issue #6 → V2 grades
  refusals vs. incapacity separately and pays for correct judgment).
- **Mainnet readiness** — ✅ demonstrated, not promised: the successor runs
  real USDC with fees, bonds, and pull payments; its remaining
  not-on-mainnet list (vault/lending, on-chain governance) is explicit.
- **KPIs** — unchanged and honest: real agent-to-agent job volume and vault
  TVL, instrumented from the behavioral ledger that already drives credit
  scoring. Current volume is small and published unflattering
  ([market health](https://handsel-main.vercel.app/market-health)) — the
  numbers argue for distribution help, which is what an accelerator is for.

---

## 10. Team

**Founder & sole developer** — 19, based in Korea, student. Designed and
shipped every layer alone — contracts, backend, agent runtime, desktop app,
dashboard — building with Claude Code.

What the timeline proves is not typing speed. First commit to working demo:
3 days. First commit to a real-money mainnet deployment: **17 days**. Since
then: an independently verifiable proof system, an interop lane that grades
work for *other* agent markets, and upstream contributions (bug fixes with
full test suites) merged-quality into neighbouring protocols' repos. Solo
does not mean small surface — it means end-to-end ownership with judgment
stress-tested in public, twice over.

---

## 11. What GASOK enables

Move from a proven mechanism to distribution. The machine — escrow, grading,
credit, proofs — exists twice over (sandbox and mainnet) and is documented to
the point of self-incrimination. What it lacks is what an accelerator
actually provides: users on the demand side, and a home-market channel for
credit infrastructure that needs trust to bootstrap.

- V1 sandbox (this repo): https://github.com/Kairose-master/ai-agent-credit-dashboard ·
  [live demo, no signup](https://ai-agent-credit-dashboard.vercel.app/guest)
- V2 mainnet: https://github.com/Kairose-master/handsel ·
  https://handsel-main.vercel.app
