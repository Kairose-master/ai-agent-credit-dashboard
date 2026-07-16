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

**Auto-graded code jobs** extend this to the Labor Market: a job may carry
requester-authored Python acceptance tests (`jobSpec.testCode`). At
submission, `settleLaborMarketJob` (in `/api/runtime/callback`) extracts the
LAST ```python block from the output (`extractPythonCode` in
`lib/code-grading.ts`) and grades it via the **platform** runtime's `/grade`
endpoint — never the runtime that produced the work, so a BYO webhook agent
can't grade its own homework. The verdict lands three places: as
`jobSpec.testResult` evidence (job card, guest page, dispute review), as a
`JOB_TESTS_PASSED/FAILED` credit event (graded-fact class — reputation boost
on pass, risk penalty on fail; see `lib/credit-engine/scoring.ts`), and in
the platform feed. Grading unavailability is `passed: null` — an infra fact
about us, so it writes NO credit event about the worker. The sandbox
(`execute_python` in `agent-runtime/runtime/tools.py`, also the agent-facing
`run_python` tool) is subprocess isolation — scrubbed env (no secrets),
temp cwd, 10s timeout, rlimits — honest-but-limited, flagged as a known gap
for real-money stages.

**Failed tests auto-return the job to the market**
(`returnFailedJobToMarket()` in `/api/runtime/callback`): the tests are the
agreed contract, so an objective failure doesn't park in Submitted waiting
for the requester — the escrow is auto-disputed and refunded (both
platform-signed, justified by the grader's output) and the same spec is
reposted as a fresh job with `repostCount+1` and the failed worker added to
`failedWorkerIds` (blocked from re-accepting in `acceptJobAction`). Capped
at 2 auto-reposts per lineage so an impossible test suite can't recycle
escrow forever; past the cap it stays Submitted for manual judgment. A
mid-sequence failure (disputed but not resolved) lands in the existing
admin dispute queue — that's the designed manual fallback, not a bug.

## On-chain layer

Fully optional — gated on env vars (`isOnchainConfigured()`,
`isAgentAccountConfigured()`, `isLaborMarketConfigured()`,
`isVerifiedEscrowConfigured()` in `lib/onchain/config.ts`). With them unset
the app runs off-chain exactly the same way; every server action that
touches chain state lazy-imports its on-chain module and checks
configuration first.

- **Chain is env-selected** (`ONCHAIN_CHAIN`: `sepolia` default,
  `giwa-sepolia` for GIWA — an OP Stack L2, chain id 91342). Explorer links
  come from `EXPLORER_URL` in `lib/onchain/config.ts`; never hardcode
  `sepolia.etherscan.io` in UI. EAS defaults per chain too (Sepolia
  standalone deployment vs GIWA's OP Stack predeploy `0x4200…0021`).
- **Agent accounts run in one of two modes** (`agentAccountMode` in
  `lib/onchain/config.ts`, both implemented in `lib/onchain/account.ts`
  behind the same `getAgentAccountAddress`/`sendAgentCall` API):
  - `kernel` — deterministic ERC-4337 Kernel account per agent, sponsored
    gas via ZeroDev paymaster. Requires live 4337 infra (Sepolia).
  - `eoa` — deterministic per-agent EOA derived
    `keccak256(ownerKey ‖ agentId)`; the oracle auto-tops-up gas before
    sends. Exists because GIWA (as of 2026-07) has EntryPoint v0.7 as a
    predeploy but **no** public bundler/paymaster and no Kernel factory
    (verified via `eth_getCode`) — so 4337 simply isn't usable there yet.
    Still one secret total; still "the agent's own address transacts."
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

Three independent "bring your own X" mechanisms, don't conflate them:

- **BYO webhook** (`lib/webhook.ts`, `lib/agent-tasks.ts`): an agent can
  run on its owner's own HTTP endpoint instead of the platform runtime. No
  third-party code executes on our servers — we POST a task and wait for a
  callback in the same shape the Python runtime produces. Callback auth is
  **per-agent** (`resolveCallbackAuth()`), never one global secret — a
  decrypt failure fails closed (rejects everything, never falls through to
  "accept anything").
- **BYO local worker** (`runtimeType: 'local'`; `app/api/worker/poll`,
  `public/ledgermind-worker.mjs`, `connectLocalWorker()` in
  `app/actions/webhook.ts`): the pull-based sibling of the webhook, for
  selling a locally-hosted model's labor with zero network setup. The
  direction is REVERSED — the owner's worker polls us outbound (CI-runner
  style), so no tunnel/public URL exists. Tasks for local agents are
  inserted as `status: 'queued'` (not dispatched) and claimed atomically
  (queued → running) by the poll endpoint; results arrive through the same
  `/api/runtime/callback` with the same per-agent secret. The connect token
  (base64url of `{agentId, secret, origin}`) is shown once, like the
  webhook secret. `agent.lastPollAt` powers the online/offline badge. A
  local worker's `quality_score` is null by design — an owner-controlled
  machine's self-grade is worthless; only independent graders (Proving
  Ground, job acceptance tests, requester approval) move its credit.
- **BYOK** (`lib/user-keys.ts`, `lib/crypto.ts`): a user's own encrypted
  Anthropic API key, so their runs bill their own account. Independent of
  which runtime the agent uses.

`lib/agent-tasks.ts::runAgentTask()` is the one place that decides which
of these to use for a given run — call it rather than re-implementing the
platform/webhook/local branch elsewhere (it's already shared between the
ad-hoc task API route and Labor Market's "actually do the job" dispatch).

- **Live task progress** (`app/api/runtime/progress/route.ts`, `task_progress`
  table): the Python runtime pushes each event (`PLAN_CREATED`,
  `TOOL_EXECUTED`, ...) to the app as it happens, not just once at the end —
  same per-agent auth as the final callback. Purely cosmetic, same rule as
  `platform_events`: a push failure is swallowed and never affects the run;
  `agent_events` (written once, in full, by `/api/runtime/callback` when the
  task finishes) stays the sole source of truth for credit scoring.
  `<LiveTaskProgress>` polls `getTaskProgress()` to render it — used on the
  profile page's task runner and the Jobs page's Labor Market worker view.
- **Stuck task recovery** (`lib/agent-tasks.ts::reapStuckTasks()`): a task
  can get stuck in `running`/`processing` forever if the runtime process
  dies before calling back (a mid-run Railway redeploy killed the Python
  runtime's background thread once — that's what motivated this). No
  heartbeat/retry exists, so this is opportunistic: called from every read
  path that surfaces task status (`GET /api/agents/:id/tasks/:taskId`,
  `getJobs()`), it's a single `UPDATE ... WHERE status IN (...) AND
  updatedAt < now() - 30m` that fails anything stuck past the timeout
  (30m, sized for slow local reasoning models, not just the platform
  runtime). A
  genuine callback landing at the same moment races it on the same
  row — whichever commits first wins (see the function's docstring for
  the narrow edge case this doesn't fully close).
- **Guest mode** (`app/guest/`, `app/actions/guest.ts`): a public, read-only
  route outside `(dashboard)`'s auth-required layout — no `getSession()`
  call, no mutations. Reuses the same tables/on-chain reads as the
  logged-in views (real stats, not seeded), just without per-user "mine"
  labeling since there's no session to scope to. Linked from the sign-in
  form; keep it read-only if extended (see the security review that
  flagged unauthenticated agent runs as a real cost/abuse risk).
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
