# Claude.md — Ledgermind project reference

This file is the living architecture reference for this repository. It
started as a build spec ("build a vertical slice") and that vertical slice
is long since done — everything below reflects **current state**, not a
to-do list, except the explicit "Not yet built" section at the end.

## What this is

An AI Agent Credit Infrastructure prototype:

> Payment lets AI agents transact. Credit lets AI agents scale.

Autonomous agents perform real economic tasks, generate genuine behavioral
history, build reputation from that history, receive a credit score, and
draw a programmable, on-chain-enforced credit limit against it. See
`README.md` for the full feature tour — this file is about how the system
is put together and the conventions to follow when extending it.

## Stack

- **Frontend/backend**: Next.js (App Router) + TypeScript + Tailwind,
  Drizzle ORM over Neon PostgreSQL, Better Auth for sessions.
- **Agent runtime**: Python + LangGraph + Anthropic Claude
  (`agent-runtime/`), a separate FastAPI service reached over HTTP —
  async (202 + callback), never blocks a Next.js request.
- **On-chain** (optional layer): Solidity contracts on Ethereum Sepolia,
  ERC-4337 smart accounts via ZeroDev (Kernel v3.1, EntryPoint v0.7),
  Ethereum Attestation Service for score attestations, `viem` for all
  client-side chain interaction.

## Architecture: how a task becomes a credit score

```
Task Input
  ↓
LangGraph Agent (planner → tool execution → evaluation)      [Python, agent-runtime/]
  ↓
Structured events (TASK_STARTED, TOOL_EXECUTED, TASK_COMPLETED/FAILED, ...)
  ↓
POST /api/runtime/callback                                    [persists to agent_events]
  ↓
recalculateCredit()                                            [lib/credit-engine/index.ts]
  ↓
assessCredit() — pure function, no I/O                         [lib/credit-engine/scoring.ts]
  ↓
score (300–990) → rating (AAA–D) → credit limit → risk level
  ↓
credit_scores history row + agent row updated + (optional) on-chain mirror
```

`assessCredit()` weights: Performance 40% · Reliability 30% · Reputation
20% · Risk 10%. Factor scores are *dampened toward neutral (50) while the
sample is small* — an agent must earn certainty, not start there. Zero
recorded tasks = floor score (300, unrated, $0 limit), never a seeded demo
value.

**The score → rating and score → risk-level thresholds are not hardcoded.**
`ratingForScore()`/`riskLevelForScore()` in `scoring.ts` take an optional
`ScoreRule[]` (a DMN-style decision table: "score ≥ threshold → outcome")
and default to `DEFAULT_RATING_RULES`/`DEFAULT_RISK_RULES` when none is
passed. `lib/credit-rules.ts` reads the live policy from
`credit_rating_rules` (falling back to the defaults if empty) and
`recalculateCredit()` threads it through on every run. An admin with the
`credit_rules` permission edits this from `/admin/credit-rules` — actual
lending policy, changeable without a code deploy. Keep `scoring.ts` pure
(no DB/network calls) — that's a load-bearing property other code relies on
(it's testable/reasoned-about without mocking I/O).

## The two grades of credit signal

Every behavioral event is one of two kinds, and the scoring engine (and the
UI) must never blur them:

1. **Self-evaluated** (`TASK_COMPLETED`/`TASK_FAILED`) — the agent runtime
   grading its own output. An opinion, not a fact.
2. **Ground-truth verified** (`VERIFIED_TASK_COMPLETED`/`_FAILED`,
   `JOB_COMPLETED`) — graded by an independent party against a hidden
   answer or an on-chain-escrowed real deliverable. A fact.

This is why Proving Ground (`app/actions/verified.ts`,
`contracts/src/VerifiedTaskEscrow.sol`) exists: the server generates the
problem *and* the hidden answer (grader ≠ solver — never the same agent),
escrows a bounty, sends only the problem to the solver, and grades
server-side on callback. It's also why Labor Market disputes
(`raiseDisputeAction`/`resolveDisputeAction` in `app/actions/labor.ts`)
route to an independent admin rather than trusting the requester's word
alone — a requester saying "this is bad work" isn't a verified signal
either.

## On-chain layer

Fully optional — gated on env vars (`isOnchainConfigured()`,
`isAgentAccountConfigured()`, `isLaborMarketConfigured()`,
`isVerifiedEscrowConfigured()` in `lib/onchain/config.ts`). With them unset
the app runs off-chain exactly the same way; every server action that
touches chain state lazy-imports its on-chain module and checks
configuration first.

- **Agent smart accounts**: one deterministic ERC-4337 Kernel account per
  agent (`lib/onchain/account.ts`), sponsored gas via ZeroDev paymaster.
- **Registry + Vault**: the scoring engine mirrors each recalculated limit
  to `AgentCreditRegistry` and writes an EAS attestation
  (`mirrorOnchain()` in `credit-engine/index.ts`); agents draw/repay real
  test USDC from `AgentCreditVault`, which enforces the limit on-chain.
- **LaborMarket.sol**: `Open → Accepted → Submitted → {Completed |
  Disputed → {Completed | Refunded}}`. `resolveDispute()` is restricted to
  an immutable `arbiter` address (the oracle EOA) — not the requester, not
  the worker. Redeploy *only this contract* with
  `contracts/script/DeployLaborMarket.s.sol` when it changes; it's wired
  to the already-deployed `MockUSDC`/`AgentCreditRegistry`, so agent
  balances and credit lines are untouched by a LaborMarket-only redeploy.
- **VerifiedTaskEscrow.sol**: commit-reveal settlement (front-running
  resistant) — the solver's answer is committed as a hash, then revealed
  once the deadline/grading resolves it.
- Server actions that call these sign either through the acting agent's
  smart account (`sendAgentCall()`) or, for arbiter/oracle actions
  (`resolveDispute`, `publishLimit`, `attestCredit`), through a plain EOA
  wallet client (`oracleWallet()` in `lib/onchain/clients.ts`) — never
  confuse the two; an agent action must be signed by that agent's account.

## Access control

Not a single `ADMIN_EMAIL === session.email` check scattered across files.
`lib/admin.ts` implements a real access control matrix: `admin_grants`
rows are (userId, permission) pairs. `ADMIN_EMAIL` is a separate
superadmin bootstrap — implicitly holds every permission, isn't a DB row,
so the grants table can never be cleared into a lockout. Gate a new
admin-only capability with `requirePermission('some_permission')` from
`lib/admin.ts`, add the permission string to the `PERMISSIONS` const, and
it's immediately manageable from `/admin/access` — don't invent a new
bespoke admin check.

## BYO everything (agent code, API key)

Two independent "bring your own X" mechanisms, don't conflate them:

- **BYO webhook** (`lib/webhook.ts`, `lib/agent-tasks.ts`): an agent can
  run on its owner's own HTTP endpoint instead of the platform runtime. No
  third-party code executes on our servers — we POST a task and wait for a
  callback in the same shape the Python runtime produces. Callback auth is
  **per-agent** (`resolveCallbackAuth()`), never one global secret — a
  decrypt failure fails closed (rejects everything, never falls through to
  "accept anything").
- **BYOK** (`lib/user-keys.ts`, `lib/crypto.ts`): a user's own encrypted
  Anthropic API key, so their runs bill their own account. Independent of
  which runtime (platform or webhook) the agent uses.

`lib/agent-tasks.ts::runAgentTask()` is the one place that decides which
of these to use for a given run — call it rather than re-implementing the
platform/webhook branch elsewhere (it's already shared between the ad-hoc
task API route and Labor Market's "actually do the job" dispatch).

- **Job attachments** (`app/api/upload/route.ts`, Vercel Blob): a Labor
  Market requester can attach source material — the file itself never
  passes through our server's LLM context. Only the Blob URL is embedded
  in the worker's task prompt; the agent runtime's `fetch_url` tool
  (`agent-runtime/runtime/tools.py`) fetches and reads it directly,
  content-type aware (HTML/text/CSV/JSON/Markdown inline, PDF via `pypdf`
  extraction, anything else an honest "can't read this" error rather than
  a hallucinated summary).

## Conventions

- **Server actions, one file per domain**, colocated in `app/actions/`
  (`labor.ts`, `verified.ts`, `marketplace.ts`, `treasury.ts`,
  `messages.ts`, `admin.ts`, `credit-rules.ts`, ...). Each starts with a
  `requireUser()`/`requireOwnedAgent()`/`requirePermission()` guard.
- **On-chain call sites wrap errors with `asActionError()`**
  (`lib/action-error.ts`) — Next.js redacts unhandled errors in
  production; without this wrapping, a failed UserOp just shows "the
  specific message is omitted" and is undebuggable from the UI.
- **Lazy-import on-chain modules** (`await import('@/lib/onchain/...')`)
  inside server actions rather than top-level, so the on-chain SDKs never
  get bundled/initialized for a deployment that isn't using them.
- **Platform events are cosmetic, not authoritative** — `logPlatformEvent()`
  writes to `platform_events` for the activity feed; it's fire-and-forget
  (errors are logged, never thrown) and never the source of truth for any
  state transition.
- **No fabricated numbers, ever.** If real data doesn't exist yet, show an
  honest empty/cold-start state — never a plausible-looking placeholder
  number. This has been violated and fixed before (a seed script and a
  `lib/data.ts`/`ui-kit.tsx` pair of unused mock files were both removed);
  don't reintroduce it.

## Known gaps (honest, not aspirational)

- `/insurance` and `/risk` pages are still static UI mockups from the
  original scaffold — not wired to real data. Don't cite them as working
  features; either wire them up or leave them alone, but don't build on
  top of the fake numbers.
- Labor Market participation (Accept/Approve/Dispute) is user-triggered;
  the *work* an accepted job does is a genuine agent run, but agents don't
  yet autonomously decide to accept jobs.
- Proving Ground currently requires solver and requester to be owned by
  the same user — real cross-user verified-task hiring isn't wired up.
- No formal audit of the Solidity contracts. Testnet only.
- Job attachments only work for text-extractable formats (HTML, plain
  text, CSV, JSON, Markdown, PDF). Binary formats (images, `.docx`,
  `.xlsx`) upload but the worker's runtime can't read their content.

## Not yet built (future architecture compatibility)

The schema and event ledger were designed so these can attach without
rework:

- **Insurance layer** (agent risk coverage, premium calculation, loss
  protection) — `insurancePolicy` table exists; nothing reads/writes it
  from real logic yet.
- **Autonomous multi-agent negotiation** — agents deciding on their own to
  post/accept jobs, rather than an owner clicking through the UI.
- **Cross-user Proving Ground** — verified tasks between agents owned by
  different users.

Do not scaffold these speculatively; build them when there's a concrete
reason to, following the conventions above.
