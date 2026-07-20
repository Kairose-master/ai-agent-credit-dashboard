/**
 * Governance — $LEDGER token, ve-lockup, and proposal voting.
 *
 * Off-chain ledger v1 (Snapshot-style, testnet). Two deliberate design
 * choices:
 *  - $LEDGER is EARNED from real contribution (completed work), never
 *    bought, so voting weight tracks genuine platform usage rather than
 *    capital — no plutocracy-by-purchase.
 *  - Vote-escrow (ve): you lock $LEDGER for a chosen duration and get
 *    voting power proportional to amount × remaining-lock-fraction. Longer
 *    commitment = more say per token; power decays linearly to zero at
 *    unlock. Locked tokens can't be re-locked or spent until they expire.
 *
 * v1 is signaling governance: a passed proposal directs the operator, who
 * executes manually. The pure math (ve decay, tally) is isolated and unit-
 * tested — it's what makes votes fair.
 */
import { db } from '@/lib/db'
import { agent, govAccount, govLock, govProposal, govVote } from '@/lib/db/schema'
import { and, eq, desc, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'

export const LEDGER_PER_COMPLETED_JOB = 10
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000
export const MIN_LOCK_WEEKS = 1
export const MAX_LOCK_WEEKS = 52
export const PROPOSAL_MIN_POWER = 10 // ve power needed to open a proposal
export const DEFAULT_PROPOSAL_DAYS = 7
export const QUORUM_POWER = 50 // min total power cast for a result to count
// Trust gate for AI-delegate auto-voting: only agents rated A or better
// (credit score ≥ 760 on the 300–990 scale) may vote on their owner's
// behalf. High trust is the whole point — a flaky agent shouldn't move a
// vote. Owner-configurable ceiling, platform-fixed floor.
export const AUTO_VOTE_MIN_SCORE = 760

export type VoteChoice = 'for' | 'against' | 'abstain'

// ---------- pure math (unit-tested) ----------

/** Voting power of a single lock at time `now`. Linear ve decay:
 *  amount × (unlockAt − now) / MAX_LOCK, clamped to [0, amount]. A fully
 *  MAX_LOCK-long lock starts at ~amount and bleeds to 0 at unlock. */
export function lockVotingPower(lock: { amount: number; unlockAt: number }, now: number): number {
  const remaining = lock.unlockAt - now
  if (remaining <= 0) return 0
  const maxMs = MAX_LOCK_WEEKS * WEEK_MS
  return Math.min(lock.amount, (lock.amount * remaining) / maxMs)
}

/** Total voting power over a set of active locks. */
export function totalVotingPower(locks: { amount: number; unlockAt: number }[], now: number): number {
  return locks.reduce((sum, l) => sum + lockVotingPower(l, now), 0)
}

export interface Tally {
  for: number
  against: number
  abstain: number
  total: number
  quorumMet: boolean
  passed: boolean
}

/** Tally weighted votes into a result. Passes iff quorum is met AND `for`
 *  strictly outweighs `against` (abstain counts toward quorum only). */
export function tallyVotes(votes: { choice: VoteChoice; power: number }[]): Tally {
  const t = { for: 0, against: 0, abstain: 0 }
  for (const v of votes) t[v.choice] += v.power
  const total = t.for + t.against + t.abstain
  const quorumMet = total >= QUORUM_POWER
  return { ...t, total, quorumMet, passed: quorumMet && t.for > t.against }
}

export interface AutoVoteAgent {
  id: string
  userId: string
  creditScore: number
  votePolicy: string | null
  autoVote: boolean
}

/** Is this agent allowed to auto-vote as its owner's delegate? Needs the
 *  opt-in flag, a trust score at/above the floor, and a non-empty stance —
 *  we never fabricate a position for an agent that has none. */
export function isAutoVoteEligible(a: AutoVoteAgent, minScore = AUTO_VOTE_MIN_SCORE): boolean {
  return a.autoVote && a.creditScore >= minScore && !!a.votePolicy && a.votePolicy.trim().length > 0
}

/** One vote per owner per proposal — so a user with several eligible agents
 *  gets a single delegate: the highest-trust one. Pure so the tie-break is
 *  unit-tested. Returns userId → chosen delegate. */
export function pickDelegateByUser(agents: AutoVoteAgent[], minScore = AUTO_VOTE_MIN_SCORE): Map<string, AutoVoteAgent> {
  const byUser = new Map<string, AutoVoteAgent>()
  for (const a of agents) {
    if (!isAutoVoteEligible(a, minScore)) continue
    const cur = byUser.get(a.userId)
    if (!cur || a.creditScore > cur.creditScore) byUser.set(a.userId, a)
  }
  return byUser
}

// ---------- ledger ops ----------

async function ensureAccount(userId: string) {
  const [acct] = await db.select().from(govAccount).where(eq(govAccount.userId, userId))
  if (acct) return acct
  await db.insert(govAccount).values({ userId, balance: '0', totalEarned: '0' }).onConflictDoNothing()
  const [created] = await db.select().from(govAccount).where(eq(govAccount.userId, userId))
  return created
}

/** Credit $LEDGER to an account (earned from contribution). Best-effort:
 *  a governance-ledger failure must never break the job-completion path
 *  that calls it. */
export async function earnLedger(userId: string, amount: number): Promise<void> {
  if (amount <= 0) return
  try {
    await ensureAccount(userId)
    await db
      .update(govAccount)
      .set({
        balance: sql`${govAccount.balance} + ${amount}`,
        totalEarned: sql`${govAccount.totalEarned} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(govAccount.userId, userId))
  } catch (error) {
    console.error('[governance] earnLedger failed (non-fatal):', error)
  }
}

/** Lock `amount` for `weeks` — moves it out of spendable balance into a ve
 *  lock. Throws on insufficient balance or out-of-range duration. */
export async function createLock(userId: string, amount: number, weeks: number) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be positive')
  if (!Number.isInteger(weeks) || weeks < MIN_LOCK_WEEKS || weeks > MAX_LOCK_WEEKS) {
    throw new Error(`Lock duration must be ${MIN_LOCK_WEEKS}–${MAX_LOCK_WEEKS} weeks`)
  }
  const acct = await ensureAccount(userId)
  if (Number(acct.balance) < amount) throw new Error(`Insufficient $LEDGER (have ${Number(acct.balance)}, need ${amount})`)

  await db
    .update(govAccount)
    .set({ balance: sql`${govAccount.balance} - ${amount}`, updatedAt: new Date() })
    .where(eq(govAccount.userId, userId))
  await db.insert(govLock).values({
    id: `lock-${nanoid(12)}`,
    userId,
    amount: amount.toFixed(6),
    unlockAt: new Date(Date.now() + weeks * WEEK_MS),
  })
}

/** Return expired locks' principal to spendable balance. Idempotent —
 *  safe to call from any governance read. */
export async function withdrawExpiredLocks(userId: string): Promise<number> {
  const now = new Date()
  const expired = await db
    .select()
    .from(govLock)
    .where(and(eq(govLock.userId, userId), eq(govLock.withdrawn, false)))
  let returned = 0
  for (const lock of expired) {
    if (lock.unlockAt > now) continue
    await db.update(govLock).set({ withdrawn: true }).where(eq(govLock.id, lock.id))
    await db
      .update(govAccount)
      .set({ balance: sql`${govAccount.balance} + ${Number(lock.amount)}`, updatedAt: new Date() })
      .where(eq(govAccount.userId, userId))
    returned += Number(lock.amount)
  }
  return returned
}

export interface GovSummary {
  balance: number
  totalEarned: number
  locked: number
  votingPower: number
  locks: { id: string; amount: number; unlockAt: string; power: number }[]
}

/** Full governance position for an account (drives the /governance page). */
export async function govSummary(userId: string): Promise<GovSummary> {
  await withdrawExpiredLocks(userId)
  const acct = await ensureAccount(userId)
  const activeLocks = (
    await db.select().from(govLock).where(and(eq(govLock.userId, userId), eq(govLock.withdrawn, false)))
  ).filter((l) => l.unlockAt > new Date())
  const now = Date.now()
  const locks = activeLocks.map((l) => ({
    id: l.id,
    amount: Number(l.amount),
    unlockAt: l.unlockAt.toISOString(),
    power: lockVotingPower({ amount: Number(l.amount), unlockAt: l.unlockAt.getTime() }, now),
  }))
  return {
    balance: Number(acct.balance),
    totalEarned: Number(acct.totalEarned),
    locked: locks.reduce((s, l) => s + l.amount, 0),
    votingPower: locks.reduce((s, l) => s + l.power, 0),
    locks,
  }
}

/** Current voting power for an account (for gating + vote weight). */
export async function currentVotingPower(userId: string): Promise<number> {
  const activeLocks = (
    await db.select().from(govLock).where(and(eq(govLock.userId, userId), eq(govLock.withdrawn, false)))
  ).filter((l) => l.unlockAt > new Date())
  const now = Date.now()
  return totalVotingPower(
    activeLocks.map((l) => ({ amount: Number(l.amount), unlockAt: l.unlockAt.getTime() })),
    now,
  )
}

// ---------- proposals & voting ----------

export async function createProposal(userId: string, title: string, body: string, days = DEFAULT_PROPOSAL_DAYS) {
  const t = title.trim()
  if (t.length < 8) throw new Error('Give the proposal a clear title (8+ characters)')
  const power = await currentVotingPower(userId)
  if (power < PROPOSAL_MIN_POWER) {
    throw new Error(`You need ≥ ${PROPOSAL_MIN_POWER} voting power to open a proposal (lock $LEDGER to gain it). You have ${power.toFixed(1)}.`)
  }
  const id = `prop-${nanoid(10)}`
  const closesAt = new Date(Date.now() + Math.max(1, Math.min(30, days)) * 24 * 60 * 60 * 1000)
  await db.insert(govProposal).values({ id, creatorUserId: userId, title: t, body: body.trim().slice(0, 5000), closesAt })
  return { id }
}

/** Cast (or refuse to overwrite) a weighted vote. Power is snapshotted at
 *  cast time; votes are immutable so late lock-topping can't re-weight a
 *  ballot already counted. */
export async function castVote(
  userId: string,
  proposalId: string,
  choice: VoteChoice,
  opts: { viaAgentId?: string | null; rationale?: string | null } = {},
) {
  const [prop] = await db.select().from(govProposal).where(eq(govProposal.id, proposalId))
  if (!prop) throw new Error('Proposal not found')
  if (prop.closesAt <= new Date()) throw new Error('Voting has closed on this proposal')

  const [existing] = await db
    .select()
    .from(govVote)
    .where(and(eq(govVote.proposalId, proposalId), eq(govVote.userId, userId)))
  if (existing) throw new Error('You already voted on this proposal')

  const power = await currentVotingPower(userId)
  if (power <= 0) throw new Error('You have no voting power — lock $LEDGER first')
  await db.insert(govVote).values({
    proposalId,
    userId,
    choice,
    power: power.toFixed(6),
    viaAgentId: opts.viaAgentId ?? null,
    rationale: opts.rationale ? opts.rationale.slice(0, 300) : null,
  })
  return { power }
}

// ---------- AI delegate auto-voting ----------

export interface VotingAgentView {
  id: string
  name: string
  creditScore: number
  eligible: boolean
  autoVote: boolean
  votePolicy: string
}

/** The caller's agents with their auto-vote eligibility + config (drives the
 *  delegate section of the /governance page). */
export async function listVotingAgents(userId: string): Promise<VotingAgentView[]> {
  const rows = await db
    .select({ id: agent.id, name: agent.name, creditScore: agent.creditScore, autoVote: agent.autoVote, votePolicy: agent.votePolicy })
    .from(agent)
    .where(eq(agent.userId, userId))
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    creditScore: Number(a.creditScore),
    eligible: Number(a.creditScore) >= AUTO_VOTE_MIN_SCORE,
    autoVote: a.autoVote,
    votePolicy: a.votePolicy ?? '',
  }))
}

/** Enable/disable an agent as its owner's voting delegate. Owner-guarded;
 *  enabling requires a trust score at/above the floor AND a stated policy. */
export async function setAutoVote(agentId: string, ownerUserId: string, enabled: boolean, policy: string) {
  const [a] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!a || a.userId !== ownerUserId) throw new Error('Agent not found')
  const trimmed = (policy ?? '').trim()
  if (enabled) {
    if (Number(a.creditScore) < AUTO_VOTE_MIN_SCORE) {
      throw new Error(
        `${a.name} needs a credit score ≥ ${AUTO_VOTE_MIN_SCORE} (rating A) to auto-vote — it's at ${Number(a.creditScore).toFixed(0)}. Complete more graded work to raise it.`,
      )
    }
    if (!trimmed) throw new Error('Set a voting policy so the delegate knows how to vote on your behalf')
  }
  await db
    .update(agent)
    .set({ autoVote: enabled, votePolicy: trimmed.slice(0, 2000), updatedAt: new Date() })
    .where(eq(agent.id, agentId))
  return { ok: true as const }
}

/** Ask an owner's LLM (BYOK, else platform key) how their delegate should
 *  vote on one proposal, given the standing policy. Returns null on any
 *  failure — auto-voting is strictly best-effort. */
async function decideDelegateVote(
  userId: string,
  policy: string,
  prop: { title: string; body: string },
): Promise<{ choice: VoteChoice; rationale: string } | null> {
  let complete: (system: string, userMsg: string, maxTokens: number) => Promise<string>
  try {
    const { resolveLlm } = await import('@/lib/delegation')
    complete = await resolveLlm(userId)
  } catch {
    return null // no LLM key for this owner — skip, don't guess
  }
  const system =
    'You are an AI governance delegate casting a vote on behalf of your owner in an AI-agent labor marketplace. ' +
    "Your owner's standing voting policy below is your ONLY mandate — vote the way it directs, not your own preferences. " +
    'Output ONLY strict JSON: {"choice":"for"|"against"|"abstain","rationale":"<=160 chars, grounded in the policy"}. ' +
    'Use "abstain" when the policy does not clearly favor either side. No commentary, no code fences.'
  const userMsg = `OWNER VOTING POLICY:\n${policy}\n\nPROPOSAL TITLE: ${prop.title}\n\nPROPOSAL BODY:\n${prop.body || '(no description provided)'}`
  let raw: string
  try {
    raw = await complete(system, userMsg, 400)
  } catch {
    return null
  }
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim())
    const choice = j?.choice
    if (choice !== 'for' && choice !== 'against' && choice !== 'abstain') return null
    return { choice, rationale: String(j?.rationale ?? '').slice(0, 200) }
  } catch {
    return null // unparseable — retry next tick rather than cast garbage
  }
}

/** Cast delegate votes for every eligible agent on every open proposal it
 *  hasn't voted on yet. Idempotent: the immutable one-vote-per-owner rule
 *  means each (proposal, owner) triggers at most one LLM decision ever, so
 *  this is cheap to run on the heartbeat. Best-effort throughout. */
export async function runAutoVotes(now = new Date()): Promise<{ openProposals: number; delegates: number; cast: number }> {
  const openProps = (await db.select().from(govProposal).where(eq(govProposal.status, 'open'))).filter(
    (p) => p.closesAt > now,
  )
  if (openProps.length === 0) return { openProposals: 0, delegates: 0, cast: 0 }

  const rows = await db.select().from(agent).where(eq(agent.autoVote, true))
  const delegates = pickDelegateByUser(
    rows.map((a) => ({
      id: a.id,
      userId: a.userId,
      creditScore: Number(a.creditScore),
      votePolicy: a.votePolicy,
      autoVote: a.autoVote,
    })),
  )
  if (delegates.size === 0) return { openProposals: openProps.length, delegates: 0, cast: 0 }

  let cast = 0
  for (const prop of openProps) {
    for (const [userId, del] of delegates) {
      const [existing] = await db
        .select({ userId: govVote.userId })
        .from(govVote)
        .where(and(eq(govVote.proposalId, prop.id), eq(govVote.userId, userId)))
      if (existing) continue // already voted (manually or by a prior tick)
      const power = await currentVotingPower(userId)
      if (power <= 0) continue // nothing locked → no weight to cast
      const decision = await decideDelegateVote(userId, del.votePolicy ?? '', { title: prop.title, body: prop.body }).catch(
        () => null,
      )
      if (!decision) continue
      try {
        await castVote(userId, prop.id, decision.choice, { viaAgentId: del.id, rationale: decision.rationale })
        cast++
      } catch {
        // raced with a manual vote or the window just closed — fine, skip.
      }
    }
  }
  return { openProposals: openProps.length, delegates: delegates.size, cast }
}

export interface ProposalView {
  id: string
  title: string
  body: string
  createdAt: string
  closesAt: string
  open: boolean
  tally: Tally
  yourVote: VoteChoice | null
  /** If your vote was cast by an AI delegate, its rationale (else null). */
  yourVoteRationale: string | null
  /** How many of the votes on this proposal were cast by AI delegates. */
  delegateVotes: number
}

/** List recent proposals with live tallies + the caller's own vote.
 *  Finalizes status on any proposal whose voting window has closed. */
export async function listProposals(userId: string | null, limit = 25): Promise<ProposalView[]> {
  const props = await db.select().from(govProposal).orderBy(desc(govProposal.createdAt)).limit(limit)
  if (props.length === 0) return []
  const votes = await db.select().from(govVote)
  const byProposal = new Map<string, typeof votes>()
  for (const v of votes) {
    const list = byProposal.get(v.proposalId) ?? []
    list.push(v)
    byProposal.set(v.proposalId, list)
  }

  const out: ProposalView[] = []
  for (const p of props) {
    const pvotes = (byProposal.get(p.id) ?? []).map((v) => ({ choice: v.choice as VoteChoice, power: Number(v.power) }))
    const tally = tallyVotes(pvotes)
    const closed = p.closesAt <= new Date()
    // Finalize status once closed (best-effort, idempotent).
    if (closed && p.status === 'open') {
      const finalStatus = tally.passed ? 'passed' : 'rejected'
      await db.update(govProposal).set({ status: finalStatus }).where(eq(govProposal.id, p.id)).catch(() => {})
    }
    const yourRow = userId != null ? (byProposal.get(p.id) ?? []).find((v) => v.userId === userId) : undefined
    const delegateVotes = (byProposal.get(p.id) ?? []).filter((v) => v.viaAgentId != null).length
    out.push({
      id: p.id,
      title: p.title,
      body: p.body,
      createdAt: p.createdAt.toISOString(),
      closesAt: p.closesAt.toISOString(),
      open: !closed,
      tally,
      yourVote: (yourRow?.choice as VoteChoice | undefined) ?? null,
      yourVoteRationale: yourRow?.viaAgentId ? yourRow.rationale ?? null : null,
      delegateVotes,
    })
  }
  return out
}
