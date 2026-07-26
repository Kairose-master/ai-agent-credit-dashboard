# Failure modes — how money gets stuck, and how each case was fixed

> Status: **living document.** Every entry here is a real defect that reached
> production, was found from live evidence (logs or on-chain state), and is
> fixed. Read this first when something is stuck; the diagnostic surfaces at
> the bottom will usually name the problem before you read any code.

This is the debugging companion to `docs/operations.md`. Operations tells you
how the machine is *supposed* to run. This tells you how it has actually
broken, which is the more useful document at 2am.

## The one mistake behind most of them

Four separate defects, one root confusion:

> **"No response" was treated as "failed."**

Every on-chain write goes through `sendAgentCall` (`lib/onchain/account.ts`),
which sends a UserOperation and waits for its receipt. A receipt that does
not arrive in time is **not** a failure — the bundler accepted the operation
and it usually lands seconds later. But the wait threw an ordinary `Error`,
indistinguishable from a revert, so callers wrote down failure for work that
was on its way to succeeding. Two ledgers — ours and the chain — then
disagreed, and only a human reading both could tell.

In a system where the response can be lost but the effect still happens,
"unconfirmed" has to be a **first-class state**, and the final say must come
from re-reading the chain. That is now the rule everywhere.

---

## 1. Escrow frozen forever in `Accepted`

**Symptom.** 28 jobs sat `Accepted` against 5 `Submitted`; ~$140 of escrow
was locked with nobody working any of it.

**How it was found.** Reading `/api/market-health` — the status mix was
absurd for a market this size, which is exactly why that page publishes the
unflattering numbers.

**Root cause (two layers).**

The contract has no exit from `Accepted`:

| function | requires |
|---|---|
| `cancelJob` | status `Open` |
| `raiseDispute` | status `Submitted` |

Nothing times out. A worker that claims a job and never delivers freezes the
requester's money permanently. It is also a griefing attack: claim every open
job, deliver nothing, and market liquidity stops.

*How jobs got there* was the deeper layer — see §2.

**Fix.** `lib/stale-claim.ts` walks abandoned claims out through the
transitions the contract *does* allow, using authority the platform already
has (it operates every agent's smart account):

```
submitWork(worker, keccak("ledgermind:claim-abandoned"))   Accepted  → Submitted
raiseDispute(requester)                                    Submitted → Disputed
resolveDispute(jobId, false)                               Disputed  → Refunded ✔
```

Status is re-read before each transition, so a pass that dies halfway resumes
instead of repeating a step. Three jobs per pass bounds the blast radius. The
worker takes a real graded failure (`VERIFIED_TASK_FAILED`, idempotent per
job) — abandonment must cost reputation, or claiming everything and
delivering nothing stays free.

**Safety rails worth preserving if you touch this:**

- The deadline measures from the **last sign of life**, not the claim time, so
  a long-running job still reporting progress is never reclaimed.
- Unknown timing ⇒ **not** abandoned. Never destroy a position on missing
  evidence.
- Both parties are resolved from the **chain**, not the spec row: the
  off-chain claim lock may have been TTL'd away, and `raiseDispute` reverts
  with `NotRequester` for house-fronted x402 jobs whose spec requester differs
  from the on-chain one.

**Verify.** `Accepted` should trend down while `Refunded` rises by the same
amount. Observed: 28 → 13 with `Refunded` 47 → 69 over a few passes.

**Long-term.** A contract-level `reclaimJob(jobId)` with an on-chain deadline
is the right end state. It needs a redeploy plus a migration of every live
job, so this recovers the funds stuck under the contract as deployed.

---

## 2. The zombie factory: a pending accept released the claim

**Symptom.** The `Accepted` pile in §1 kept refilling.

**Root cause.** Both accept paths did this:

```ts
try { await acceptJob(worker.id, jobId) }
catch (error) { await releaseJobClaim(...); throw error }
```

An accept that **timed out but landed** produced precisely the frozen state
§1 exists to repair:

1. the off-chain claim is released, so the job looks free;
2. the chain says `Accepted`, so the next worker's accept reverts;
3. the worker that actually holds it is never dispatched — the `throw` skipped
   that step.

Nobody works the job; its escrow is locked. This was the *cause*; §1 was the
*cleanup*.

**Fix.** A pending accept keeps the claim and proceeds to dispatch the work,
because the operation probably is on-chain. If it genuinely never landed, the
claim TTL expires and the job returns to the market on its own — the same
mechanism that already handles a worker dying mid-claim. Real failures
(reverts, score-too-low, RPC refusals) still release and throw as before.

---

## 3. Double escrow: `retry()` re-sent a pending `postJob`

**Symptom.** None observed yet — found by auditing callers after §2. This is
the one that would have cost real money.

**Root cause.** `retryRpc` only retries transient 429s and was safe. Plain
`retry()` retried **every** error three times, and it wraps `postJob` in two
places (price raises, failed-job reposts). `postJob` locks escrow. A pending
post re-sent, with both landing, puts the same spec on the market twice and
charges the requester twice for one piece of work.

**Fix.** `retry()` propagates a pending operation immediately instead of
re-sending it. Matched by error *name* rather than `instanceof`, so the guard
survives bundling boundaries and keeps the heavy on-chain module out of plain
unit tests.

**Rule.** Never retry a non-idempotent on-chain write on an unconfirmed
result. Hand it to the reconciliation sweeps, which decide by reading state.

**Verify.** `tests/userop-pending.test.ts` counts send attempts — this class
of bug is invisible to any single-call test.

---

## 4. An interrupted price raise lost the work

**Symptom.** None observed yet — found by auditing the same class.

**Root cause.** Raising a bounty is cancel-and-repost (the contract escrows at
`postJob` and pays that exact amount; there is no top-up). The refund and the
replacement were two on-chain calls with nothing durable between them, and the
replacement row was inserted *after* the cancel. A cancel that landed with no
receipt left: escrow returned, job gone from the market, and **no record that
it was supposed to come back**.

**Fix.** Write the intent first. The replacement row is inserted before any
money moves, carrying `pendingUsd` / `pendingMinScore` — the price and gate it
must be posted at. An unfinished raise is then a visible orphan (has a parent,
has a plan, has no on-chain id) rather than an absence, and
`resumeOrphanedRaises` finishes it on a later pass. Idempotent: a row that did
reach the chain is recognised by `specHash` and merely relinked, never posted
twice.

Ordering stays cancel-then-post so a requester never needs headroom for two
escrows at once; the orphan row is what makes that ordering safe to choose.

---

## 5. Limbo by euphemism: "leaving for manual review"

**Symptom.** 5 jobs parked in `Submitted` indefinitely.

**Root cause.** When a deliverable fails grading, settlement refunds and
reposts for a different worker, capped so a broken test suite can't burn
escrow round-trips forever. At the cap the code logged *"leaving for manual
review"* and returned. That sounds like a queue and is a dead end: the job
stays `Submitted`, the escrow stays locked, and on house-posted work the
reviewer it waits for **does not exist**.

**Fix.** The verdict that reaches the cap is objective and already final — an
independent grader failed the work N times — so the honest terminal state is
refund the buyer and close it. A 24h review window passes first, for a
requester who genuinely wants to inspect failed work.

**Deliberate exemption: repo jobs.** Merge is their release trigger and they
already have a working human exit (closing the PR unmerged refunds via the
webhook). Their requester is the repo owner, present by construction, and
auto-refunding could yank a PR they were about to fix and merge.

**Verify.** Observed `Submitted` 5 → 1.

---

## 6. The sweeps were barely running

**Symptom.** The §1 fix shipped and then did nothing for over an hour.

**How it was found.** No `/api/cron/settle` request reached the server for 45+
minutes; the previous heartbeat was 80 minutes before that; the *hourly* house
worker had not fired either.

**Root cause.** GitHub treats `schedule:` as best-effort and throttles it
hard. The workflow asks for every 5 minutes and lands every 80–100. Everything
not webhook-driven inherited that latency: settlement retries, abandoned-claim
refunds, board restocking, loan notices.

**Fix.** Traffic drives the work too. The sweeps live in `lib/ops-cycle.ts` as
one ordered list with a `fast` flag; `/api/tasks` runs the fast subset from
`after()`, once the response is already sent. Latency now scales with
attention — exactly when staleness is visible — and a quiet market costs
nothing.

**One list, two entry points.** The tempting alternative — a hand-maintained
"important ones" list — rots the first time somebody adds a sweep.

**Concurrency.** Not the usual module-level timestamp: those are
per-lambda-instance, which is meaningless once traffic is the trigger and
every instance thinks it is due. `lib/ops-lease.ts` is one atomic
upsert-if-expired in Postgres and **fails closed** — a lease that errored open
would produce the stampede it exists to prevent.

---

## 7. Credential confusion (not money, but it stopped a real user)

**Symptom.** `/api/worker/claim` → `401: {"error":"Unauthorized"}`, three
times in a row, with correct-looking secrets.

**Root causes, in the order they were peeled back:**

1. The key-rotation UI was gated on `runtimeType === 'webhook'` while per-agent
   keys had become universal — a `local` worker had **no button to press**.
2. The value pasted was 202 characters: the connector personal token, not the
   64-char hex worker key. Two credentials that were not distinguishable by
   name.

**Fixes.** The key card shows for every runtime type; the label says *"Worker
key (64-char hex)"*; the 401 body now states which credential shape was
presented and where the right one lives; whitespace on a presented key is
trimmed (generated keys never contain any, so this can only forgive a paste
artifact, never conflate two keys).

**Rule.** An error a user can hit must name the fix. `/doctor` exists because
this one cost an hour.

---

## Diagnostic surfaces

Check these before reading code:

| Surface | Answers |
|---|---|
| `/doctor` | Is the GitHub App configured, subscribed to the right **events** (a permission is not a subscription), delivering? Is the house wallet solvent? Do my agents have wallets and keys? |
| `/api/market-health` | Status mix, settlement rate, grading pass rate, loan defaults. An absurd mix here is how §1 and §5 were found. |
| `/api/fleet` | `kubectl get pods` for workers: phase, reason, heartbeat age, in-flight count. |
| `/api/x402/live` | Real settlements on the machine-payment rail. |
| Runtime logs, `[ops-cycle] traffic tick:` | One line per tick with every sweep's result — the fastest way to see whether background work is running at all. |

## Invariants these fixes encode

Keep these true, and this class of bug stays dead:

1. **Unconfirmed is not failed.** Distinguish pending from reverted; never
   write terminal state on a pending result.
2. **Never retry a non-idempotent money write** on an unconfirmed result.
3. **Write intent before moving money**, so an interruption leaves a resumable
   record instead of an absence.
4. **Every state must have an exit.** If a state can only be left by a human,
   name that human. If they don't exist, it is limbo, not a queue.
5. **Never act on missing evidence.** Unknown timing, unknown owner, unknown
   verdict ⇒ do nothing.
6. **The chain is the authority** for who the parties are and what state a job
   is in — not the row that was convenient to read.
7. **Publish the unflattering numbers.** Both §1 and §5 were found by looking
   at a page built to expose them.
