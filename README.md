# AI Agent Credit Dashboard

Prototype of an **AI Agent Credit Infrastructure** — a new financial primitive:

> Payment allows AI agents to transact. **Credit allows AI agents to scale.**

The system lets autonomous AI agents perform economic tasks, generate behavioral
history, build reputation, receive credit scores, and obtain programmable credit
limits.

## The vertical slice

```
AI Agent executes task (Python · LangGraph · Claude)
  ↓
Behavior emits structured events (TASK_STARTED, PLAN_CREATED, TOOL_EXECUTED, TASK_COMPLETED/FAILED)
  ↓
Events persisted in Neon PostgreSQL (agent_events)
  ↓
Credit scoring engine recalculates (Performance 40% · Reliability 30% · Reputation 20% · Risk 10%)
  ↓
Score, rating, limit, and risk level update (credit_scores + agent)
  ↓
Dashboard reflects the agent's economic state
```

## Repository layout

| Path                 | Role                                                             |
| -------------------- | ---------------------------------------------------------------- |
| `agent-runtime/`     | Python LangGraph agent runtime (Claude planner → tools → evaluator), FastAPI service |
| `lib/credit-engine/` | Credit scoring engine — all financial logic lives here, outside API routes |
| `app/api/agents/`    | REST API: run tasks, read agent state, events, credit history    |
| `app/(dashboard)/`   | Next.js dashboard (credit profile, task runner, activity timeline, credit evolution) |
| `scripts/migrate.mjs`| Idempotent database migration for Neon PostgreSQL                |

## Getting started

### 1. Database (Neon PostgreSQL)

```bash
cp .env.example .env.local   # fill in DATABASE_URL
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

Open [http://localhost:3000](http://localhost:3000), sign up, then go to
**Profile** and run a task — the agent executes it, events land in the
database, and the credit score updates live.

## API

| Endpoint                              | Description                                    |
| ------------------------------------- | ---------------------------------------------- |
| `POST /api/agents/:id/tasks`          | Execute a task on the agent runtime, persist events, recalculate credit |
| `GET  /api/agents/:id`                | Identity, performance metrics, credit state    |
| `GET  /api/agents/:id/events`         | Behavioral event history                       |
| `GET  /api/agents/:id/credit-history` | Score/limit changes with calculation reasons   |

## Credit scoring

Implemented in `lib/credit-engine/scoring.ts` (documented in-code):

- **Performance (40%)** — task success rate, output quality, completed volume
- **Reliability (30%)** — quality consistency, recent failure frequency, SLA compliance
- **Risk-adjusted trust** builds with sample size: factor scores are dampened
  toward neutral while behavioral history is thin, so agents must *earn* certainty
- Score maps to a 300–990 scale → rating (AAA–D), programmable credit limit
  (quadratic above the lending floor), and risk level (LOW–HIGH)

## On-chain layer (Ethereum Sepolia · optional)

The off-chain credit limit is enforced on-chain: the scoring engine publishes
each recalculated limit to an `AgentCreditRegistry` and attests the score via
EAS, and each agent's ERC-4337 (ZeroDev Kernel) smart account draws/repays real
test USDC from an `AgentCreditVault` that enforces the limit on-chain.

```
scoring engine → CreditRegistry.setLimit + EAS attestation   (oracle)
agent smart account ──draw()──▶ CreditVault (enforces limit, sends mUSDC)
```

Contracts live in `contracts/`, the integration in `lib/onchain/`. The layer is
fully optional — with the on-chain env vars unset the app runs off-chain exactly
as before. See **`contracts/README.md`** for the deploy runbook.

## Future architecture compatibility

An insurance layer (agent risk coverage, premium calculation) can attach to the
same event ledger and score history without schema rework (see `Claude.md`).

## Built with v0

This repository is linked to a [v0](https://v0.app) project:
[Continue working on v0 →](https://v0.app/chat/projects/prj_xQNHbAoGUfKypcNYlv8jaT2Bz3tq)
