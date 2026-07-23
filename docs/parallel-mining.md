# Parallel block mining — architecture & roadmap

> Status: **Phase 1 shipped** (server-side N-slot mining + parallel cross-agent
> sweep). Phases 2–4 are specced here for a follow-up session.

## Why

Until now every agent was a **single-slot serial consumer**. The whole
work-execution layer ran one job at a time:

- `autoMineTick` refused to claim anything while the agent had *any* active
  task (a hard idle gate) and `return`ed after the **first** claim — one job
  per tick.
- Cross-agent sweeps (`tickCloudAutoMineAgents`, the cron delegation loop) were
  plain `for … of` with `await` inside — agent N+1 waited for agent N.
- The reference local worker (`public/ledgermind-worker.mjs`) ran one task,
  then slept 3s — a single-threaded loop.

The only genuinely parallel primitive was **delegation** (a prime posts N
escrowed subtasks that N *different* workers pick up) — but the parallelism
came entirely from independent workers each running the serial loop, not from
any concurrency in the platform itself.

Goal: let **many agents work in parallel in the background**, each chewing
through **blocks** (claimable work units) several at a time — closer to how
OpenClaw fans a task across a pool of agents — without giving up the on-chain
escrow as the source of truth.

## The model: server = truth, worker = executor (hybrid)

```
        ┌──────────────────────────── SERVER (source of truth) ───────────────────────────┐
        │  on-chain escrow (Sepolia)   job_specs.claimedByAgentId/claimedAt (90s lease)     │
        │  agent_tasks queue (status machine)   credit / settlement                         │
        └───────────────▲───────────────────────────────────────────────▲──────────────────┘
                        │ atomic claim (one winner)                       │ callback (result)
             ┌──────────┴───────────┐                       ┌────────────┴───────────┐
             │  WORKER SESSION A     │   … in parallel …     │  WORKER SESSION B       │
             │  pulls K blocks,      │                       │  pulls K blocks,        │
             │  runs them concurrently                       │  runs them concurrently │
             └───────────────────────┘                       └─────────────────────────┘
```

- **The server never trusts a worker to avoid double-claim.** A block is leased
  by the existing atomic `claimJobSpec` (`lib/labor-dispatch.ts`): a single
  `UPDATE … WHERE unclaimed-or-mine-or-stale RETURNING`, so exactly one claimer
  wins and a crashed claimer's lease self-expires after 90s.
- **A "block" is one claimable work unit** — today a Labor Market job spec (and,
  in delegation, one subtask of the DAG). Same lease mechanism either way.
- **Concurrency is bounded everywhere.** Free-tier RPC/bundler limits make
  unbounded `Promise.all` a hazard, so every fan-out has a ceiling.

### The nonce rule (why "parallel" is split two ways)

Each `acceptJob` is an ERC-4337 UserOp from the agent's **single smart
account**, and UserOps from one account share a nonce. Fire two accepts for the
**same agent** in parallel and they collide (same nonce → one reverts).

So parallelism is split along the only safe axis:

| Level | Parallel? | Why |
|---|---|---|
| Blocks **within one agent** | **Serial** | shared account nonce on `acceptJob` |
| **Across agents** | **Parallel** (bounded) | distinct smart accounts, independent nonces |
| Off-chain execution (LLM calls) | Parallel | no chain writes until submit |

## Phase 1 — server-side N-slot mining ✅ (this session)

What shipped:

- **`lib/mining-scheduler.ts`** — the pure core. `selectMiningBlocks()` takes
  the open jobs + the agent + how many slots are free and returns the ordered
  subset to claim; `isEligibleBlock()` encodes every per-job rule (Open,
  minScore, no self-deal, faucet grace, failed-lineage, live-claim, capability)
  as a tested pure function; `freeMiningSlots()` / `resolveMiningConcurrency()`
  compute the ceiling. Order is preserved from on-chain id order → **FIFO/fair**
  (no cherry-picking the fattest bounty ahead of older work).
- **`lib/concurrency.ts`** — `mapLimit(items, limit, fn)`, a bounded-parallel
  map that preserves input order.
- **`autoMineTick` refactor** — replaces the idle gate + single claim with:
  count in-flight tasks → `free = ceiling − inFlight` → self-heal up to `free`
  accepted-but-taskless jobs → select up to `free` blocks → **accept them
  serially** (nonce) via the existing `acceptAndDispatchJob` (which still takes
  the atomic lease per block). Also collapses the old per-job `N+1` spec lookup
  into one `inArray` query. `maxSlots === 1` reproduces the exact old behaviour.
- **`tickCloudAutoMineAgents`** — the serial cloud sweep becomes
  `mapLimit(agents, resolveSweepConcurrency(), …)`: agents run **in parallel**,
  bounded.

Immediate effect:

- **Cloud agents** (platform dispatches via `after()`): real parallel execution
  now — one agent runs several blocks at once, and several agents run at once.
- **Local agents**: pipeline is kept **full** — the worker always has the next
  task queued instead of a full accept round-trip (with 3s idle) between each
  job. True parallel *execution* on the local side is Phase 2.

Config (env, both bounded to [1, 8]):

- `MINING_CONCURRENCY` — per-agent block ceiling (default **3**).
- `MINING_SWEEP_CONCURRENCY` — how many agents a sweep runs at once (default **4**).

Tests: `tests/mining-scheduler.test.ts`, `tests/concurrency.test.ts`.

## Phase 2 — worker session pool (local true-parallel)

Give the reference worker (and the desktop Rust worker) a **session manager**:
pull a *batch* of queued tasks and run K concurrently instead of `runOne` →
`sleep`. Off-chain execution is nonce-free, so K can be higher than the accept
ceiling. Submits stay serial per agent (submit may be an on-chain tx). Adds a
`--concurrency K` flag to `ledgermind-worker.mjs` and a slot count to the
desktop miner. Server already supports it (Phase 1 fills the queue).

## Phase 3 — durable block queue + real scheduler

Today background progress needs either a running local worker's 3s poll or a
human loading a page; the only owned scheduler is a **daily** Vercel cron (plus
an optional 5-min GitHub Action), and it does **not** run auto-mine. Phase 3:

- A `mining_block` table (or generalise `agent_tasks`) as a durable queue with
  a lease + heartbeat renewal for long blocks (extend the 90s TTL model).
- A short-interval heartbeat that fans agents out with `mapLimit` and shares a
  single `readJobs()` snapshot across the batch (the cron already passes one
  `jobs` array into `tickDelegation` — generalise that to kill RPC read
  amplification).
- Drive delegation's wave scheduler from the same parallel tick instead of the
  current serial, opportunistic ticks.

## Phase 4 — delegation as first-class parallel blocks

`delegation.subtasks` is already a `dependsOn` DAG with wave scheduling and
dependency-output injection — the "block-by-block, multi-agent" data model
already exists; it's just ticked serially. Fold delegation subtasks into the
same block queue so a delegated plan and open-market mining share one parallel
executor, and lift the deliberate 2s job-posting spacing once posting is
nonce/rate managed centrally.

## Invariants (don't regress)

1. **One winner per block** — always take `claimJobSpec` before spending gas.
2. **Serial accepts within an agent** — never `Promise.all` accepts for one
   smart account.
3. **Bounded fan-out** — every cross-agent parallel step goes through `mapLimit`.
4. **No fake data** — blocks are real on-chain jobs; every number stays a live
   query.
5. **Graceful degradation** — no worker running and no traffic ⇒ nothing
   happens, exactly as before.
