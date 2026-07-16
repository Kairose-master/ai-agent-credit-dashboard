# Ledgermind — AI Agent Credit Infrastructure

A working prototype of a new financial primitive:

> Payment lets AI agents transact. **Credit lets AI agents scale.**

Autonomous AI agents perform real economic tasks, generate genuine behavioral
history, build reputation from that history (not from self-reported claims),
receive a credit score, and draw a programmable, on-chain-enforced credit
limit against it. Everything downstream — who can hire whom, how much they
can borrow, who gets paid — is driven by that history. Nothing is seeded or
faked: every agent starts at a real cold start (score 0, unrated) and earns
its numbers.

**Pitch deck:** [`docs/pitch-deck.md`](docs/pitch-deck.md)

## Core loop

```
AI Agent executes a task (Python · LangGraph · Claude, or the owner's own webhook)
  ↓
Behavior emits structured events (TASK_STARTED, TOOL_EXECUTED, TASK_COMPLETED/FAILED, ...)
  — live-pushed to the dashboard as they happen (task_progress, cosmetic) —
  ↓
Events persisted in Neon PostgreSQL (agent_events) — the single source of truth
  ↓
Credit scoring engine recalculates (Performance 40% · Reliability 30% · Reputation 20% · Risk 10%)
  ↓
Score, rating, credit limit, risk level update — mirrored on-chain (registry + EAS attestation)
  ↓
That creditworthiness gates what the agent can do next: draw credit, accept
paid work, sell its "recipe" — closing the loop back into more behavior
```

## What's actually built

Everything below is wired to real data and real on-chain transactions
(Sepolia testnet) — no seeded numbers, no static mockups, unless explicitly
noted otherwise in **Known limitations**.

### Credit scoring
Behavioral events → a weighted score (300–990) → rating (AAA–D) → a
programmable credit limit → risk level. Self-reported success and
ground-truth-*verified* success are weighted differently (see Proving
Ground below) — an agent can't inflate its own score just by grading its
own homework. The score → rating/risk-level thresholds are not hardcoded:
they're a DMN-style decision table an admin can edit live (see **Access
control & policy editing**).

### On-chain layer (Ethereum Sepolia, optional)
Each agent gets a real ERC-4337 smart account (ZeroDev / Kernel v3.1,
sponsored gas via paymaster). The scoring engine mirrors every recalculated
limit to an on-chain registry and attests the score via EAS. Agents draw and
repay real test USDC from a vault that enforces the on-chain limit. The
whole layer is optional — with the env vars unset, everything above runs
off-chain exactly the same way.

### Labor Market (`/jobs`)
A two-sided market where one agent's on-chain credit score gates whether it
can accept another agent's job:
1. Requester escrows a USDC bounty on-chain, writes **specific acceptance
   criteria** (what "done" means, enforced at submission time), and may
   attach **source material** (a PDF, CSV, text, or Markdown file — Vercel
   Blob-backed) for the worker to actually act on.
2. A worker whose score clears the job's threshold accepts.
3. Accepting **actually dispatches the worker's real runtime** (platform
   Claude runtime or the owner's own webhook) with the job — and any
   attachment's URL — as its task; the runtime's `fetch_url` tool reads the
   attachment (HTML/text/CSV/JSON/Markdown/PDF) before doing the work. This
   is genuine agent work, not a button that pretends work happened.
4. The real output is submitted on-chain automatically when the run
   finishes.
5. **Auto-graded code jobs**: a requester can attach Python acceptance
   tests. The worker must deliver runnable code, and at submission time the
   *platform* runtime (never the worker's own) runs the tests in a sandbox —
   the pass/fail verdict is recorded on the job as objective evidence and
   feeds the worker's credit as a graded fact (`JOB_TESTS_PASSED/FAILED`),
   the same trust class as Proving Ground grading.
6. The requester reviews the real output and either approves (escrow
   releases immediately, worker's reputation updates) or disputes it.
7. A disputed job locks until an independent party (not the requester, not
   the worker) reviews the actual requirements vs. the actual output — plus
   the test verdict, when there is one — and force-settles either way; a
   requester can no longer withhold payment forever just by refusing to
   click Approve.

A BPMN 2.0 diagram of this exact flow (Requester / Worker / Arbiter
swimlanes) is rendered live on the Jobs page.

### Proving Ground / Verified Tasks (`/verify`)
The trustworthy-signal answer to "an AI grading its own work isn't a
credible reputation signal." The server procedurally generates a problem
and a hidden answer (**grader ≠ solver** — the solving agent never sees the
answer), escrows a bounty on-chain, and on callback grades the real output
against the hidden ground truth server-side. A correct answer settles the
escrow via commit-reveal (front-running resistant); credit events from this
path are marked as verified facts, not self-evaluated opinions, and the
scoring engine weighs them accordingly.

### Agent Template Marketplace (`/jobs`)
Publish an agent's "recipe" (its custom instructions) for other users to
spawn their own copy of, priced or free. Listings show a genuine portfolio
pulled from the exemplar agent's real history (current score, verified-task
pass count, real sample outputs) — never a marketing claim. Credit history
never transfers: a cloned agent starts at a real cold start and earns its
own reputation.

### Treasury — autonomous wallet
Every agent's smart account is a real wallet: it can send USDC on its own
mid-task (a tool the agent runtime can call), receive deposits, and
self-mint test USDC for funding. Spending is capped (per-transaction and
rolling 24h limits); self-minting is logged as a distinct event type
specifically so it can never be used to inflate or bypass the spending cap.

### BYO Agent (bring your own code)
Instead of running on the platform's Python/LangGraph runtime, an agent can
run on its owner's own infrastructure, two ways:

- **Local worker (one command)** — sell a locally-hosted model's labor with
  zero network setup: the dashboard mints a single copy-paste command
  (`node ledgermind-worker.mjs --token …`) whose worker process polls the
  platform *outbound* (CI-runner style), runs each task on Ollama / LM
  Studio / any OpenAI-compatible endpoint, and posts the result back. No
  webhook server, no tunnel, works behind any firewall. Local workers
  can't self-score: only independent graders move their credit.
- **Webhook** — the platform POSTs the task to an https endpoint you host
  (any framework), and your server calls back with the result.

Either way, the callback format is the same one the built-in runtime uses —
no third-party code ever executes on our servers, and auth is scoped
per-agent (one agent's secret can never claim or forge another agent's
work).

### BYOK (bring your own key)
Each user can store their own Anthropic API key (AES-256-GCM encrypted at
rest, never logged, never returned to the client) so their agent runs bill
their own account — this is what makes public deployment of this prototype
cost-sustainable.

### Social layer
Direct messages between any two users (`/messages`, polling-based — no
third-party real-time service), a cross-user activity feed on the
dashboard (jobs posted/completed, templates published/bought), and
"message the creator" buttons on marketplace listings.

### Access control & policy editing
A real access control matrix (`admin_grants`: user × permission), not a
single hardcoded admin flag — different accounts can hold different
capabilities (`disputes`, `credit_rules`, ...). One `ADMIN_EMAIL` acts as
a superadmin bootstrap that implicitly holds every permission, so the
matrix can never lock the operator out. From `/admin/credit-rules`, a
holder of the `credit_rules` permission edits the score → rating and
score → risk-level decision tables directly — the actual lending policy,
changeable with no code deploy.

### Balance sheet (`/profile`)
Every agent gets a real financial statement: Assets (USDC balance, undrawn
credit line, receivables — bounties already escrowed for its delivered,
not-yet-approved work) minus Liabilities (outstanding drawn credit) = Net
Worth. Every figure is a live read; nothing is inferred.

## Known limitations

- **Insurance (`/insurance`) and Risk Analytics (`/risk`) pages are still
  static UI mockups** carried over from the original scaffold — not wired
  to real data. Everything else listed above is real.
- **Labor Market job acceptance is user-triggered, not agent-autonomous**:
  an owner clicks Accept/Approve/Dispute; the *work* an accepted job does
  is genuinely autonomous (a real agent run), but the market-participation
  decisions themselves aren't yet made by the agent on its own.
- Proving Ground currently requires the solver and requester to be agents
  owned by the same user (useful for self-testing the verification
  mechanism; genuine cross-user verified-task hiring isn't wired up yet).
- **Job attachments only support text-extractable formats**: HTML, plain
  text, CSV, JSON, Markdown, and PDF (via `pypdf`). Binary formats like
  images, `.docx`, and `.xlsx` upload fine but the worker's runtime
  honestly reports it can't read them rather than fabricating content.
- No formal security audit of the Solidity contracts. Testnet only.

## Repository layout

| Path                      | Role                                                                 |
| -------------------------- | --------------------------------------------------------------------- |
| `agent-runtime/`           | Python LangGraph agent runtime (planner → tools → evaluator), FastAPI service |
| `lib/credit-engine/`       | Pure credit scoring math (`scoring.ts`) + persistence entry point (`index.ts`) |
| `lib/credit-rules.ts`      | Reads the admin-editable rating/risk decision table, falls back to shipped defaults |
| `lib/onchain/`             | All Sepolia integration — smart accounts, registry/vault, labor market, verified-task escrow, treasury |
| `lib/admin.ts`             | Access control matrix (`requirePermission`, grant/revoke) |
| `lib/agent-tasks.ts`       | Shared "start a real agent run" dispatch (platform runtime or BYO webhook) |
| `lib/webhook.ts`           | BYO-agent callback auth (per-agent secret, fail-closed) |
| `lib/bpmn/`                | BPMN 2.0 diagram source for the Labor Market flow |
| `lib/verifiable/`          | Procedural problem/answer generation for verified tasks (grader ≠ solver) |
| `app/actions/`             | Server actions — one file per domain (labor, verified, marketplace, treasury, messages, admin, credit-rules, ...) |
| `app/api/agents/`          | REST surface: start/poll tasks, read agent state/events/credit history |
| `app/api/runtime/callback` | Where the Python runtime or a BYO webhook reports task completion |
| `app/(dashboard)/`         | Next.js dashboard — see feature list above for the full page map |
| `app/guest/`               | `/guest` — read-only, no-login snapshot of real platform data (stats, activity, open jobs, templates) for visitors deciding whether to sign up |
| `app/(dashboard)/admin/`   | `/admin/disputes`, `/admin/credit-rules`, `/admin/access` — permission-gated |
| `contracts/`                | Solidity: `MockUSDC`, `AgentCreditRegistry`, `AgentCreditVault`, `LaborMarket`, `VerifiedTaskEscrow` + Foundry deploy scripts |
| `scripts/migrate.mjs`      | Idempotent SQL migration for Neon PostgreSQL |

## Getting started

### 1. Database (Neon PostgreSQL)

```bash
cp .env.example .env.local   # fill in DATABASE_URL at minimum
pnpm install
pnpm db:migrate
```

### 2. Agent runtime (Claude-powered)

```bash
cd agent-runtime
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
uvicorn runtime.server:app --port 8000
```

### 3. Dashboard

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), sign up, then run a
task from the Profile page — the agent executes it for real, events land in
the database, and the credit score updates live.

### 4. On-chain layer (optional)

See `contracts/README.md` for the full deploy runbook (Foundry install,
contract deploy, EAS schema registration, env var wiring). Leave the
on-chain env vars unset to run entirely off-chain.

### 5. Test scenarios

Step-by-step, exact-field walkthroughs for exercising real flows live in
`docs/test-scenarios/`:

- [`labor-market-dispute.md`](docs/test-scenarios/labor-market-dispute.md) —
  post → real agent run → dispute → independent resolution, end to end.
- [`byo-webhook-agent.md`](docs/test-scenarios/byo-webhook-agent.md) —
  point an agent at your own HTTP endpoint instead of the platform
  runtime, with a minimal local test double you can run in minutes.
- [`auto-graded-code-job.md`](docs/test-scenarios/auto-graded-code-job.md) —
  a code job with requester-authored acceptance tests, mechanically graded
  by the platform runtime (grader ≠ solver) and fed into the worker's credit.
- [`local-worker.md`](docs/test-scenarios/local-worker.md) — sell your
  locally-hosted model's labor with one command: the worker polls outbound
  (no tunnel/webhook needed) and does paid jobs from your own machine.

## Environment variables

The canonical, commented list lives in `.env.example` — copy it to
`.env.local` and fill in what you need. Highlights:

| Variable | Required for |
| --- | --- |
| `DATABASE_URL` | Everything (Neon Postgres) |
| `BETTER_AUTH_URL`, `AGENT_RUNTIME_URL` | Core app / runtime wiring |
| `API_KEY_ENCRYPTION_SECRET`, `RUNTIME_SHARED_SECRET` | BYOK + runtime↔app auth |
| `BLOB_STORE_ID` (or legacy `BLOB_READ_WRITE_TOKEN`) | Labor Market job attachments — added automatically when a Vercel Blob store is connected (optional) |
| `ADMIN_EMAIL` | Superadmin bootstrap for the access control matrix |
| `SEPOLIA_RPC_URL`, `ZERODEV_RPC`, `ORACLE_PRIVATE_KEY`, `AGENT_OWNER_PRIVATE_KEY`, `*_ADDRESS` vars | On-chain layer (all optional together) |
| `ONCHAIN_CHAIN` | `sepolia` (default) or `giwa-sepolia` — selects the chain the on-chain layer talks to |
| `ONCHAIN_RPC_URL` | Chain RPC (falls back to `SEPOLIA_RPC_URL`); e.g. `https://sepolia-rpc.giwa.io` for GIWA |
| `AGENT_ACCOUNT_MODE` | `kernel` (ERC-4337 via ZeroDev; Sepolia) or `eoa` (derived per-agent EOAs; GIWA, where 4337 infra isn't live yet). Auto-detected from `ZERODEV_RPC` when unset |
| `WALLET_MAX_TX_USD`, `WALLET_DAILY_CAP_USD` | Treasury spending caps |

## API

| Endpoint                              | Description                                    |
| -------------------------------------- | ----------------------------------------------- |
| `POST /api/agents/:id/tasks`           | Start an async task (platform runtime or BYO webhook); returns immediately |
| `GET  /api/agents/:id`                 | Identity, performance metrics, credit state    |
| `GET  /api/agents/:id/events`          | Behavioral event history                       |
| `GET  /api/agents/:id/credit-history`  | Score/limit changes with calculation reasons   |
| `GET  /api/agents/:id/tasks/:taskId`   | Poll an async task's result                    |
| `POST /api/runtime/callback`           | Runtime/webhook reports task completion (auth resolved per-task's-owning-agent) |

Everything else (Labor Market, Marketplace, Treasury, Messages, Admin,
Credit Rules, ...) is exposed as Next.js server actions under
`app/actions/` rather than REST — see the repository layout table above.

## Database

Full schema in `lib/db/schema.ts`. Grouped roughly as: Better Auth tables
(`user`/`session`/`account`), the behavioral ledger (`agent`,
`agent_events`, `agent_tasks`), credit history (`credit_scores`,
`credit_rating_rules`), on-chain-adjacent off-chain metadata (`job_specs`,
`verifiable_tasks`), the social layer (`dm_threads`, `dm_messages`,
`platform_events`), the marketplace (`agent_templates`,
`agent_template_purchases`), access control (`admin_grants`), and BYOK
(`user_api_keys`).

## Development principles

- **No fabricated numbers, ever.** A new agent starts at score 0, unrated —
  never a seeded demo value. If a UI needs to show "nothing yet," it says
  so explicitly rather than showing a plausible-looking fake figure.
- **Self-reported success is not the same signal as verified success.**
  The scoring engine, the marketplace portfolio, and the Labor Market
  dispute path all treat "the agent says it succeeded" and "an independent
  party confirmed it succeeded" as different-strength evidence.
- **Fail closed, not open.** Auth/decrypt failures (webhook secrets, BYOK
  keys) reject everything rather than falling through to "accept anything."
- **Financial logic stays out of API routes and components.** It lives in
  `lib/credit-engine`, `lib/onchain/`, and `app/actions/`, called from thin
  route handlers and client components.
- Keep the on-chain layer fully optional — the whole app must still work
  with none of those env vars set.

## Repository history

This started as a single vertical slice (agent → events → score →
dashboard) and grew feature-by-feature into the system described above.
`Claude.md` is the project's living architecture reference for whoever (or
whatever agent) picks up work here next.

## Support this project

Ledgermind is a solo, open-source build. If it's been useful to you and
you'd like to help keep it going, donations are welcome:

```
0xe274231b7d91dDa77cdbD150B7b5E4fA6F5140ae
```
