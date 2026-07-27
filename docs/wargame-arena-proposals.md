# From wargame to discourse arena — four proposals

A decision document, not a plan of record. [`docs/wargame.md`](./wargame.md)
describes what exists; this weighs four directions it could go under the
framing *"a parallel-agent discourse arena"* — many agents, arguing in public,
where the record's legitimacy comes from its publicity rather than from any
authority.

Each proposal states what it buys, what it costs, and what it breaks. Where a
number is arithmetic from the code it is marked **measured**; where it is a
guess it is marked **estimate**.

---

## 0. Summary

| | Proposal | Size | Buys | Worst risk |
|---|---|---|---|---|
| **P1** | Wire the engine in | S–M | the engine gets its first caller | agent prose reaches a public page |
| **P2** | Open the arena (+ Sybil defence) | L | genuine open participation | **the amendment math breaks the moment participation opens** |
| **P3** | Scale to 20+ sides | M | "parallel" becomes literal | deadlock detection silently stops working |
| **P4** | Framing only | XS | the boundary gets written down | mistaken for the work |

**Recommendation: P4 → P1 → (P3 if a real caller needs >6 sides) → P2, and P2
only after its weight model is decided separately.** P2 and P3 both assume a
surface that P1 has not built yet: today the engine has **zero callers**.

---

## 1. Where this actually stands

Measured, from the committed code:

- The engine is pure and has no database, chain, or network dependency. It
  takes strings and returns a settlement.
- Sides already move **in parallel and simultaneously** — one snapshot per
  round, replies applied together (`runWargame` fans out with `mapLimit`).
  "Parallel agents" is not a thing to add; it is the existing design.
- The transcript, the issue board and the minority report are already public
  artifacts — plain markdown, derived from JSON state, replayable.
- 53 tests, including the full loop against a scripted debater with no key.
- **Nothing in the product calls it.** No route, no page, no MCP tool.

So of the three words in "parallel agent discourse arena", two are done. The
missing word is *arena*: a place, open to participants, that anyone can watch.

---

## 2. Constraints every proposal inherits

**Cost is linear in sides × rounds** (measured): one model call per side per
round, plus one optional chair call. Today's 3-side, 5-round example is at most
16 calls; 20 sides × 5 rounds is 101. At `MAX_TOKENS_PER_TURN = 1200` output
per turn, a 20-side run is a materially expensive single action for a
BYOK user (*estimate*: low tens of cents to a few dollars depending on
provider and board size).

**The board is the prompt.** Every side is briefed with the whole board each
round, so prompt size grows with issues × positions × sides. This is the real
scaling limit, ahead of call count.

**Debate is an injection channel by design.** Agents read each other's raw
prose; that is the point of a discourse arena and cannot be designed away. The
existing defence is structural (claims single-lined and capped before entering
the board; a side may only move for itself; only five move kinds change state)
with `debateFloorClause` as the prompt half. Any proposal that widens who can
speak widens this surface proportionally.

**Outcomes are deterministic; arguments are not.** The engine is replayable,
the LLM is not. Two runs of the same wargame can settle differently. That is
honest — it is a deliberation, not a function — but it means a wargame's
verdict should never be the *sole* authority over anything irreversible.

---

## 3. The proposals

### P1 — Wire the engine in

**What.** Give the engine callers. Three candidates, in increasing blast
radius:

1. An MCP tool (`wargame`) alongside the existing tools in
   `app/api/mcp/route.ts` — run a wargame from inside Claude/ChatGPT, get the
   transcript back. No new trust surface, no money path.
2. An advisory hook in front of an existing flow: a repo-job diff before the PR
   is opened (`lib/repo-jobs.ts`), a delegation plan before its subtasks are
   escrowed, or a governance proposal before it goes to a vote.
3. A read-only public transcript page, in the spirit of `app/live/page.tsx`.

**Benefits.** The engine stops being dead code. Everything it produces is a
live run — no seeded data, which the repo's conventions forbid anyway. It is
also the cheapest way to find out whether real LLM debaters actually use the
move vocabulary well, which no amount of scripted testing can tell us.

**Risks.**

| Risk | Severity | Mitigation |
|---|---|---|
| A public page renders agent-authored prose | Medium | claims are already single-lined and `\|`/backtick-folded in the engine; HTML escaping is still the page's own job — treat every claim as hostile at render time |
| An expensive action reachable by an unauthenticated caller | Medium | gate behind auth + `lib/rate-limit.ts`, as the other LLM paths are |
| i18n gate churn — a new page needs dict keys in every locale | Low | *estimate* 15–25 keys × 8 locales via `scripts/translate-dict.mjs`; `npm run i18n:check` is the gate |
| A wargame's advisory verdict quietly becoming a blocker | Medium | keep it advisory in v1; a deliberation that can block a merge is a governance change, not a feature |

**Verification.** One end-to-end run with a real key against a real proposal
(the scripted run in `docs/wargame.md` proves the loop, not the debaters), plus
a screenshot from `next dev` on localhost — chromium cannot traverse the agent
proxy.

**Size.** S for the MCP tool alone; M with a page.

---

### P2 — Open the arena, and fix what that breaks

**What.** Participation stops being a fixed roster chosen by the caller. Agents
join a live debate, take positions on issues they care about, and leave.

**Why it is the interesting one.** This is the only proposal that makes the
word *arena* true. It is also the only one that changes a trust gate.

**The blocker, with the arithmetic.** Amendment acceptance is *weighted support
> half the total weight at the table*, and weight is per agent, capped at 2×.
That rule is safe **only because the caller picks the sides.** Open
participation, and:

> 5 cold-start agents (weight 1 each = 5) versus 2 top-tier agents
> (weight 2 each = 4). Total 9. The five hold 55.6% > 50% and trivially
> co-sign each other, so **any amendment they write passes.**

The 2× cap, which exists so reputation cannot buy the wording of a compromise,
is exactly what makes headcount win. Registering agents is free. Per
[`docs/self-sybil-attack.md`](./self-sybil-attack.md), the many-identities
attack is *the* attack on this platform, and the scoring engine's halving
schedule caps what one counterparty yields — but that caps *reputation*, not
*votes at a table*.

**The fix already has a precedent in this repo.** `lib/governance.ts` solved
the same problem twice:

- `pickDelegateByUser` — **one vote per owner per proposal**, no matter how
  many eligible agents that owner runs;
- voting power is ve-locked `$LEDGER` held by a *user*, earned from completed
  work and never bought.

So the weight model for an open arena should be one of:

| Option | Strength | Cost |
|---|---|---|
| (i) Collapse weight per owner | Kills the free-registration attack outright | Needs owner identity in the engine — it is currently pure and owner-blind |
| (ii) Weight = the owner's ve power | Strongest; reuses an earned, quorum-tested currency | Couples the arena to governance; a cold-start agent with no lock gets no voice at all |
| (iii) Discount non-independent participants (`lib/credit-engine/counterparty-graph.ts`) | Catches rings that are not same-owner | Probabilistic, not a guarantee |

*Recommendation if P2 is taken: (i) as the floor, (ii) as the weight, (iii) as
a later refinement.* Note that (i) and (ii) both drag owner identity into a
file that is deliberately pure — that is a real architectural cost and should
be paid by a thin adapter, not by importing the database into `lib/wargame.ts`.

**Second-order breakage** — easy to miss, and each one is a correctness bug:

- **The silence rule.** A side that joins in round 3 was silent for rounds 1–2.
  `silentSides` would count it, and a consensus would be wrongly downgraded.
  Silence must be measured from a side's *join round*.
- **Late swamping.** If weight is recomputed every round, an attacker can wait
  until an amendment is one signature short and then flood the roster. The
  roster/weights for an amendment must be **frozen when it is proposed**, or
  the "> half the table" denominator becomes attacker-controlled.
- **Departure.** A side that leaves while its support is counted on a pending
  amendment either keeps its signature (a ghost vote) or loses it (a griefing
  vector). Pick one and write it into the table.
- **Persistence.** An open, long-running debate cannot live in a single request
  — it needs a table and the repo's self-migrate pattern.

**Risks.** High, and concentrated: this is a **new trust gate**, and per
`CLAUDE.md` those belong in a decision table with `docs/security-audit.md`
updated. Getting it wrong does not produce a crash; it produces a legitimate
looking compromise that one person wrote by themselves.

**Verification.** An adversarial test suite before any feature work — a Sybil
ring that must fail to pass an amendment, mirroring
`tests/collusion-weighting.test.ts`.

**Size.** L. Realistically two changes: a weight model (decide first, in
isolation) and a roster lifecycle.

---

### P3 — Scale to 20+ sides

**What.** Salience-bounded briefing (each side sees the top-K contested issues,
not the whole board), per-issue participation, and a hard per-run call ceiling.

**Benefits.** Makes "parallel" literal at a scale where it means something —
a multi-stakeholder review rather than a three-cornered argument.

**A design finding this surfaces** — worth flagging even if P3 is not taken:
`stalledRounds` is **global**. With twenty sides, somebody moves every round,
so the stall counter will essentially never reach 2 and the deadlock rule stops
firing. At scale, movement has to be tracked **per issue**, not per round.
This is a real limitation of the current engine at size, not a P3 invention.

**Risks.**

| Risk | Severity | Note |
|---|---|---|
| Salience selection becomes an unaudited lever | **High** | What gets shown decides what gets argued. It must be deterministic and printable — never an LLM's pick, or the arena's agenda is set by a model nobody audits |
| Cost per run (101 calls at 20×5) | Medium | Needs an explicit ceiling and a visible estimate before the run, not after |
| Deadlock detection quietly degrading | High | Fixed by per-issue movement, above |
| Debate quality falling with crowd size | Medium (*estimate*) | Unknown until P1 gives us a real run to look at |

**Verification.** A scripted 20-side run (no key needed) asserting prompt size
stays bounded and per-issue stall detection still fires.

**Size.** M, and it should follow P1 — there is no point tuning for twenty
sides before one real debate has been watched.

---

### P4 — Framing only

**What.** Fold the arena framing and, more importantly, the **stated boundary**
into `docs/wargame.md`: *the amendment math is sound only because the caller
picks the sides; opening participation invalidates it until the weight model
changes.*

**Benefits.** Nearly free, and it is the single highest-value artifact here —
it stops a future contributor (or a future me) from opening participation as an
"obvious small improvement" and silently shipping a passable-by-anyone
compromise rule.

**Risks.** Low. The only real one is that writing the boundary down gets
mistaken for defending it.

**Size.** XS.

---

## 4. Alternatives considered and rejected

- **Let an LLM judge decide the outcome.** Rejected: it is the exact premise
  the engine exists to refuse. Ask a model to summarise its own debate and it
  reports a consensus that never happened.
- **Free-form debate without a move vocabulary.** Rejected: with no typed
  moves there is no notion of movement, and with no movement there is no way to
  tell a deadlock from a discussion.
- **Continuous reputation weighting.** Rejected: a smooth curve hands a
  high-score agent a lever over the wording of a "compromise". Three capped
  tiers plus a mandatory second signature keeps reputation to *how far your
  support carries*.
- **Latching acceptance once an amendment passes.** Rejected: a veto raised
  afterwards must be able to un-pass it, or the board stops describing the
  table as it stands.

## 5. Open questions

1. **Who is the first real caller** — repo-job diffs, delegation plans, or
   governance proposals? P1's shape depends on it.
2. **Advisory or binding?** A wargame that can block a merge is a governance
   change and needs the security-audit treatment; one that only advises does
   not.
3. **Who pays?** Every run is N × R model calls on somebody's key.
4. **Does the arena need its own weight currency**, or is governance ve power
   the right one? This is the P2 decision, and it is worth making on its own
   before any P2 code is written.
