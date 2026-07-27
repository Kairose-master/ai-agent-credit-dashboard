/**
 * Wargame — an adversarial deliberation engine.
 *
 * Peer review (lib/delegation.ts) asks ONE agent a yes/no question about
 * another's work: APPROVE or REVISE. That is a verdict, not a deliberation.
 * A wargame is the other shape: several agents with *conflicting mandates*
 * argue a proposed revision out, in the open, over bounded rounds, and the
 * engine decides — mechanically — whether they reached agreement, struck a
 * compromise, deadlocked, or hit a veto nobody would lift.
 *
 * The whole point is that the OUTCOME IS NOT THE MODEL'S OPINION. An LLM
 * writes the arguments; this file decides what they add up to. Every rule
 * below is pure, deterministic and unit-tested, so a wargame's result can be
 * replayed from its transcript by anyone who doubts it.
 *
 * Six moves, and only six — the vocabulary IS the protocol:
 *
 *   assert    open (or restate) a position on a contested point
 *   challenge attack another side's position — argument, no state change
 *   amend     propose concrete revised text that would settle a point
 *   support   back someone else's amendment (this is how a compromise passes)
 *   concede   drop your own position — the only way YOU close a point
 *   block     a red line: veto that stops settlement until it is withdrawn
 *             (`withdraw` lifts your own block)
 *
 * Note what `challenge` deliberately does NOT do: it never moves the state.
 * Two agents can rebut each other until the sun burns out and the board will
 * not budge — which is exactly what a deadlock is, and how this engine
 * detects one. Only conceding, amending, supporting, blocking or lifting a
 * block counts as movement. Rhetoric is free; positions cost something.
 *
 * Weight comes from the credit score the agent actually earned (DEBATE_WEIGHT
 * _TABLE) — a reputable agent's support carries further, but it is capped at
 * 2× so no single voice can pass a compromise alone.
 *
 * Pure and dependency-free apart from the decision-table engine, in the same
 * spirit as lib/collab-dsl.ts: JSON state is canonical, and the markdown
 * transcript / issue board are projections of it.
 */
import { evaluate, type DecisionTable } from '@/lib/decision-table'

// --- Types ----------------------------------------------------------------

export type MoveKind = 'assert' | 'challenge' | 'amend' | 'support' | 'concede' | 'block' | 'withdraw'

export const MOVE_KINDS: readonly MoveKind[] = ['assert', 'challenge', 'amend', 'support', 'concede', 'block', 'withdraw']

/** A participant with a mandate to argue from. Weight is its vote share when
 *  an amendment is counted; default 1. */
export interface WargameSide {
  id: string
  label: string
  /** What this side is charged with defending — the source of the conflict. */
  mandate: string
  weight?: number
}

/** A validated, normalized move. Free text has already been single-lined and
 *  length-capped by parseMoves — these strings get pasted into other agents'
 *  prompts and into the transcript, so they are structurally inert. */
export interface WargameMove {
  side: string
  kind: MoveKind
  /** Slug of the contested point. Empty only for `support`, which targets an
   *  amendment id instead. */
  issue: string
  /** Human-readable title, carried on the move that first opens an issue. */
  issueTitle?: string
  claim: string
  /** `challenge`: the side whose position is being attacked. */
  target?: string
  /** `amend`: the concrete revised text being proposed. */
  amendment?: string
  /** `support`: the amendment id being backed. */
  amendmentId?: string
  confidence: number
}

export interface WargamePosition {
  side: string
  claim: string
  confidence: number
  conceded: boolean
}

export interface WargameChallenge {
  side: string
  target: string
  claim: string
  round: number
  /** Set when the challenger later conceded the issue — a retracted challenge
   *  no longer keeps the point contested. */
  retracted: boolean
}

export interface WargameBlock {
  side: string
  claim: string
  round: number
  lifted: boolean
}

export interface WargameIssue {
  id: string
  title: string
  positions: WargamePosition[]
  challenges: WargameChallenge[]
  blocks: WargameBlock[]
  openedRound: number
}

export interface WargameAmendment {
  id: string
  issue: string
  side: string
  text: string
  round: number
  /** Sides backing it, excluding the proposer (who counts automatically). */
  supporters: string[]
  accepted: boolean
  /** Weighted support share at the last recompute, 0..1. */
  support: number
}

export interface WargameRound {
  round: number
  moves: WargameMove[]
  /** State-changing moves this round — 0 means nobody actually moved. */
  movement: number
}

export interface WargameState {
  proposal: string
  sides: WargameSide[]
  maxRounds: number
  /** Weighted share of the table an amendment needs to pass. Default 0.5 —
   *  strictly greater than, so a dead-even split does NOT pass. */
  acceptThreshold: number
  round: number
  issues: WargameIssue[]
  amendments: WargameAmendment[]
  transcript: WargameRound[]
}

export type IssueStatus = 'agreed' | 'compromise' | 'blocked' | 'open'

export type WargameOutcome = 'continue' | 'consensus' | 'compromise' | 'deadlock' | 'blocked'

export interface WargameSettlement {
  outcome: WargameOutcome
  reason: string
  /** The proposal plus every accepted amendment, in acceptance order. A
   *  mechanical merge — see weaveRevision() in lib/wargame-run.ts for the
   *  optional LLM pass that turns it into one coherent document. */
  revision: string
  acceptedAmendments: WargameAmendment[]
  openIssues: WargameIssue[]
  /** Dissent, recorded rather than erased: every position still held on an
   *  unresolved point, plus every standing veto. */
  minorityReport: { side: string; issue: string; claim: string; kind: 'position' | 'block' }[]
  convergence: number
  rounds: number
}

// --- Normalization --------------------------------------------------------

const MAX_MOVES_PER_SIDE = 4
const MAX_CLAIM_CHARS = 240
const MAX_AMENDMENT_CHARS = 800

const oneLine = (s: string): string => String(s ?? '').replace(/\s+/g, ' ').trim()

/**
 * Neutralize a value before it enters the shared record.
 *
 * Same reasoning as `safe()` in lib/collab-dsl.ts, and it matters more here:
 * a claim written by side A is rendered into the issue board that side B
 * reads as its briefing next round. A claim carrying newlines or markdown
 * headings could forge board rows — inventing positions, amendments or
 * "CHAIR:" instructions that B reads as the engine's own words. Collapsing
 * whitespace and folding the characters the board grammar uses closes that:
 * a claim can no longer span lines or open a structure. Claims are
 * single-sentence by nature, so nothing legitimate is lost.
 */
function safeClaim(s: string, max = MAX_CLAIM_CHARS): string {
  return oneLine(s).replace(/[|`]/g, "'").slice(0, max)
}

/** Amendment text is a block, so newlines survive — but the fence markers and
 *  board pipes do not. */
function safeBlock(s: string, max = MAX_AMENDMENT_CHARS): string {
  return String(s ?? '')
    .replace(/\r/g, '')
    .replace(/^\s*[#>]+/gm, '')
    .replace(/[|`]/g, "'")
    .trim()
    .slice(0, max)
}

export function slugIssue(title: string): string {
  return (
    oneLine(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'issue'
  )
}

const clamp01 = (n: unknown): number => {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0.6
  return Math.min(1, Math.max(0, v))
}

/** Pull the first JSON array/object out of a model reply that may be fenced,
 *  prefixed with prose, or both. Returns null when there is nothing parseable. */
export function extractJson(text: string): unknown {
  const raw = String(text ?? '')
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = [fenced?.[1], raw].filter((c): c is string => Boolean(c && c.trim()))
  for (const c of candidates) {
    const trimmed = c.trim()
    // Whichever bracket opens first is the outer shape — an object wrapping
    // {"moves":[…]} must not be mistaken for the array nested inside it.
    const shapes = (
      [
        ['[', ']'],
        ['{', '}'],
      ] as const
    )
      .map(([open, close]) => ({ start: trimmed.indexOf(open), end: trimmed.lastIndexOf(close) }))
      .filter((s) => s.start !== -1 && s.end > s.start)
      .sort((a, b) => a.start - b.start)
    for (const { start, end } of shapes) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1))
      } catch {
        /* try the next shape */
      }
    }
  }
  return null
}

export interface ParseMovesResult {
  moves: WargameMove[]
  /** Moves thrown away, with why — surfaced so a debater that keeps forging
   *  identities or inventing issues is visible rather than silently ignored. */
  rejected: { reason: string; raw: unknown }[]
}

/**
 * Parse one side's reply into moves it is actually allowed to make.
 *
 * Three rules do the real work:
 *
 * 1. **No speaking for anyone else.** A move whose `side` is neither this
 *    side's id nor its label is dropped as forgery. Otherwise a debater could
 *    emit `{"side":"safety","kind":"concede"}` and surrender on its opponent's
 *    behalf — winning the argument by writing the opponent's lines.
 * 2. **Only some moves may open an issue.** assert / amend / block can raise a
 *    new contested point; challenge / support / concede / withdraw must name
 *    one that already exists (or an existing amendment), so a side cannot
 *    concede or support something into existence.
 * 3. **Everything is length-capped and single-lined** before it can reach
 *    another agent's prompt (see safeClaim).
 */
export function parseMoves(
  text: string,
  ctx: { side: WargameSide; state: WargameState },
): ParseMovesResult {
  const parsed = extractJson(text)
  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { moves?: unknown })?.moves)
      ? ((parsed as { moves: unknown[] }).moves)
      : []

  const knownIssues = new Set(ctx.state.issues.map((i) => i.id))
  const knownAmendments = new Map(ctx.state.amendments.map((a) => [a.id, a]))
  const knownSides = new Set(ctx.state.sides.map((s) => s.id))
  const selfNames = new Set([ctx.side.id.toLowerCase(), ctx.side.label.toLowerCase()])

  const moves: WargameMove[] = []
  const rejected: ParseMovesResult['rejected'] = []

  for (const raw of list) {
    if (moves.length >= MAX_MOVES_PER_SIDE) {
      rejected.push({ reason: 'over the per-round move cap', raw })
      continue
    }
    if (!raw || typeof raw !== 'object') {
      rejected.push({ reason: 'not an object', raw })
      continue
    }
    const r = raw as Record<string, unknown>

    const declaredSide = oneLine(String(r.side ?? '')).toLowerCase()
    if (declaredSide && !selfNames.has(declaredSide)) {
      rejected.push({ reason: `move attributed to "${declaredSide}" — a side may only move for itself`, raw })
      continue
    }

    const kind = oneLine(String(r.kind ?? '')).toLowerCase() as MoveKind
    if (!MOVE_KINDS.includes(kind)) {
      rejected.push({ reason: `unknown move kind "${kind}"`, raw })
      continue
    }

    const claim = safeClaim(String(r.claim ?? r.text ?? ''))
    const issueTitle = oneLine(String(r.issueTitle ?? r.issue ?? ''))
    const issueId = slugIssue(String(r.issue ?? r.issueTitle ?? ''))
    const confidence = clamp01(r.confidence)

    if (kind === 'support') {
      const amendmentId = oneLine(String(r.amendmentId ?? r.amendment ?? '')).toLowerCase()
      const amendment = knownAmendments.get(amendmentId)
      if (!amendment) {
        rejected.push({ reason: `support names unknown amendment "${amendmentId}"`, raw })
        continue
      }
      if (amendment.side === ctx.side.id) {
        rejected.push({ reason: 'a side cannot support its own amendment (it already counts)', raw })
        continue
      }
      moves.push({ side: ctx.side.id, kind, issue: amendment.issue, claim, amendmentId, confidence })
      continue
    }

    const opensIssue = kind === 'assert' || kind === 'amend' || kind === 'block'
    if (!issueId || issueId === 'issue') {
      rejected.push({ reason: 'move names no issue', raw })
      continue
    }
    if (!opensIssue && !knownIssues.has(issueId)) {
      rejected.push({ reason: `${kind} names unknown issue "${issueId}"`, raw })
      continue
    }
    if (kind !== 'withdraw' && !claim) {
      rejected.push({ reason: `${kind} carries no claim`, raw })
      continue
    }

    const move: WargameMove = {
      side: ctx.side.id,
      kind,
      issue: issueId,
      claim,
      confidence,
      ...(issueTitle ? { issueTitle } : {}),
    }

    if (kind === 'challenge') {
      const target = oneLine(String(r.target ?? '')).toLowerCase()
      const resolved = ctx.state.sides.find((s) => s.id.toLowerCase() === target || s.label.toLowerCase() === target)
      if (!resolved || !knownSides.has(resolved.id)) {
        rejected.push({ reason: `challenge names unknown side "${target}"`, raw })
        continue
      }
      if (resolved.id === ctx.side.id) {
        rejected.push({ reason: 'a side cannot challenge itself', raw })
        continue
      }
      move.target = resolved.id
    }

    if (kind === 'amend') {
      const amendment = safeBlock(String(r.amendment ?? r.text ?? ''))
      if (!amendment) {
        rejected.push({ reason: 'amend carries no amendment text', raw })
        continue
      }
      move.amendment = amendment
    }

    moves.push(move)
  }

  return { moves, rejected }
}

// --- State ----------------------------------------------------------------

export function createWargame(input: {
  proposal: string
  sides: WargameSide[]
  maxRounds?: number
  acceptThreshold?: number
}): WargameState {
  const sides = input.sides.map((s) => ({ ...s, weight: s.weight ?? 1 }))
  if (sides.length < 2) throw new Error('a wargame needs at least two sides')
  const ids = new Set<string>()
  for (const s of sides) {
    if (ids.has(s.id)) throw new Error(`duplicate side id: ${s.id}`)
    ids.add(s.id)
  }
  return {
    proposal: input.proposal,
    sides,
    maxRounds: Math.max(1, input.maxRounds ?? 4),
    acceptThreshold: input.acceptThreshold ?? 0.5,
    round: 0,
    issues: [],
    amendments: [],
    transcript: [],
  }
}

const cloneState = (s: WargameState): WargameState => ({
  ...s,
  sides: s.sides.map((x) => ({ ...x })),
  issues: s.issues.map((i) => ({
    ...i,
    positions: i.positions.map((p) => ({ ...p })),
    challenges: i.challenges.map((c) => ({ ...c })),
    blocks: i.blocks.map((b) => ({ ...b })),
  })),
  amendments: s.amendments.map((a) => ({ ...a, supporters: [...a.supporters] })),
  transcript: s.transcript.map((t) => ({ ...t, moves: t.moves.map((m) => ({ ...m })) })),
})

const totalWeight = (s: WargameState): number => s.sides.reduce((n, x) => n + (x.weight ?? 1), 0)
const weightOf = (s: WargameState, sideId: string): number => s.sides.find((x) => x.id === sideId)?.weight ?? 1

/** An issue has a standing veto when at least one block on it is unlifted. */
const activeBlocks = (issue: WargameIssue): WargameBlock[] => issue.blocks.filter((b) => !b.lifted)

/**
 * Recompute every amendment's support share and acceptance.
 *
 * Three conditions, all required:
 *   - at least one supporter besides the proposer — a compromise is by
 *     definition something more than one side agreed to, so no side can pass
 *     its own text no matter how much reputation it carries;
 *   - weighted backing strictly above the threshold (default half the table),
 *     so a dead-even split does not pass;
 *   - no standing veto on the issue.
 *
 * Pure over state and never latched: lifting a veto can pass an amendment and
 * a fresh veto can un-pass one, so the board always reflects the table as it
 * stands rather than the order things happened in.
 */
function recomputeAcceptance(state: WargameState): void {
  const total = totalWeight(state)
  for (const a of state.amendments) {
    const backing = weightOf(state, a.side) + a.supporters.reduce((n, s) => n + weightOf(state, s), 0)
    a.support = total > 0 ? backing / total : 0
    const issue = state.issues.find((i) => i.id === a.issue)
    const vetoed = issue ? activeBlocks(issue).length > 0 : false
    a.accepted = a.supporters.length > 0 && !vetoed && a.support > state.acceptThreshold
  }
}

/**
 * Apply one round of moves and return the next state.
 *
 * `movement` counts only moves that changed the board — a new issue, a new or
 * revised position, a concession, a new amendment, a new supporter, a veto
 * raised or lifted. Challenges are argument, and argument alone is never
 * movement; that is what makes a stalled round a real signal (see
 * WARGAME_OUTCOME_TABLE).
 */
export function applyMoves(prev: WargameState, moves: WargameMove[]): WargameState {
  const state = cloneState(prev)
  const round = state.round + 1
  let movement = 0

  const issueById = new Map(state.issues.map((i) => [i.id, i]))
  const ensureIssue = (id: string, title: string): WargameIssue => {
    const found = issueById.get(id)
    if (found) return found
    const created: WargameIssue = {
      id,
      title: safeClaim(title || id, 120),
      positions: [],
      challenges: [],
      blocks: [],
      openedRound: round,
    }
    state.issues.push(created)
    issueById.set(id, created)
    movement++
    return created
  }

  for (const move of moves) {
    if (!state.sides.some((s) => s.id === move.side)) continue

    if (move.kind === 'support') {
      const amendment = state.amendments.find((a) => a.id === move.amendmentId)
      if (!amendment || amendment.side === move.side || amendment.supporters.includes(move.side)) continue
      amendment.supporters.push(move.side)
      movement++
      continue
    }

    const issue = ensureIssue(move.issue, move.issueTitle ?? move.issue)

    switch (move.kind) {
      case 'assert': {
        const existing = issue.positions.find((p) => p.side === move.side)
        if (!existing) {
          issue.positions.push({ side: move.side, claim: move.claim, confidence: move.confidence, conceded: false })
          movement++
        } else if (existing.claim !== move.claim || existing.conceded) {
          // Restating a position verbatim is not movement; revising it — or
          // reopening one you had conceded — is.
          existing.claim = move.claim
          existing.confidence = move.confidence
          existing.conceded = false
          movement++
        } else {
          existing.confidence = move.confidence
        }
        break
      }
      case 'challenge': {
        if (!move.target) break
        issue.challenges.push({ side: move.side, target: move.target, claim: move.claim, round, retracted: false })
        break // argument, never movement
      }
      case 'amend': {
        const id = `a${state.amendments.length + 1}`
        state.amendments.push({
          id,
          issue: issue.id,
          side: move.side,
          text: move.amendment ?? move.claim,
          round,
          supporters: [],
          accepted: false,
          support: 0,
        })
        movement++
        break
      }
      case 'concede': {
        const existing = issue.positions.find((p) => p.side === move.side)
        let changed = false
        if (!existing) {
          // Conceding a point you never argued is how a side says "no
          // objection" on the record — worth keeping, because consensus below
          // requires that every side actually spoke.
          issue.positions.push({ side: move.side, claim: move.claim, confidence: move.confidence, conceded: true })
          changed = true
        } else if (!existing.conceded) {
          existing.conceded = true
          existing.claim = move.claim || existing.claim
          changed = true
        }
        // Conceding the point also retracts the arguments you made on it —
        // otherwise a side could concede and still keep the issue contested.
        for (const c of issue.challenges) {
          if (c.side === move.side && !c.retracted) {
            c.retracted = true
            changed = true
          }
        }
        if (changed) movement++
        break
      }
      case 'block': {
        if (activeBlocks(issue).some((b) => b.side === move.side)) break
        issue.blocks.push({ side: move.side, claim: move.claim, round, lifted: false })
        movement++
        break
      }
      case 'withdraw': {
        let changed = false
        for (const b of issue.blocks) {
          if (b.side === move.side && !b.lifted) {
            b.lifted = true
            changed = true
          }
        }
        if (changed) movement++
        break
      }
    }
  }

  recomputeAcceptance(state)
  state.round = round
  state.transcript.push({ round, moves, movement })
  return state
}

// --- Reading the board ----------------------------------------------------

export function issueStatus(state: WargameState, issue: WargameIssue): IssueStatus {
  if (activeBlocks(issue).length > 0) return 'blocked'
  if (state.amendments.some((a) => a.issue === issue.id && a.accepted)) return 'compromise'
  const held = issue.positions.filter((p) => !p.conceded)
  const liveChallenges = issue.challenges.filter(
    (c) => !c.retracted && held.some((p) => p.side === c.target),
  )
  const contested = held.length >= 2 || (held.length >= 1 && liveChallenges.length >= 1)
  return contested ? 'open' : 'agreed'
}

export const openIssues = (state: WargameState): WargameIssue[] =>
  state.issues.filter((i) => issueStatus(state, i) === 'open')

export const blockedIssues = (state: WargameState): WargameIssue[] =>
  state.issues.filter((i) => issueStatus(state, i) === 'blocked')

export const acceptedAmendments = (state: WargameState): WargameAmendment[] =>
  state.amendments.filter((a) => a.accepted)

/** Share of raised issues that reached agreement or compromise. An empty
 *  board is 0 — nothing has been settled, which is not the same as everything
 *  being agreed. */
export function convergence(state: WargameState): number {
  if (state.issues.length === 0) return 0
  const settled = state.issues.filter((i) => {
    const s = issueStatus(state, i)
    return s === 'agreed' || s === 'compromise'
  }).length
  return settled / state.issues.length
}

/**
 * Sides that have not made a single move in any round.
 *
 * A side can be silent because its model call failed, because it emitted
 * nothing parseable, or because everything it sent was discarded (a side that
 * only ever forged moves for other sides has said nothing). Whatever the
 * cause, the engine refuses to read silence as agreement: consensus requires
 * that every side spoke. A compromise does not — an amendment is defined by
 * who actually signed it.
 */
export function silentSides(state: WargameState): string[] {
  const spoke = new Set(state.transcript.flatMap((r) => r.moves.map((m) => m.side)))
  return state.sides.filter((s) => !spoke.has(s.id)).map((s) => s.id)
}

/** Trailing rounds in which nobody moved the board. */
export function stalledRounds(state: WargameState): number {
  let n = 0
  for (let i = state.transcript.length - 1; i >= 0; i--) {
    if (state.transcript[i].movement > 0) break
    n++
  }
  return n
}

// --- The gates, as decision tables ---------------------------------------

/**
 * How far an agent's earned reputation carries in a debate.
 *
 * Deliberately coarse and capped. Weight has to mean something — a market
 * whose product is a track record cannot then say a cold-start agent's vote
 * counts the same as one that has passed a hundred graded jobs — but a
 * continuous curve would hand a high-score agent an unearned lever over the
 * wording of a "compromise". Three tiers and a 2× ceiling, on top of the rule
 * that an amendment needs a second signature regardless of weight — so
 * reputation decides how far your support carries, never whether you need any.
 */
export const DEBATE_WEIGHT_TABLE: DecisionTable = {
  name: 'Debate vote weight by reputation',
  hitPolicy: 'FIRST',
  inputs: [{ key: 'creditScore', label: 'Credit score', type: 'number' }],
  outputs: [
    { key: 'weight', label: 'Vote weight' },
    { key: 'note', label: 'Why' },
  ],
  rules: [
    { when: ['<600'], then: [1, 'cold start or below the minimum reputation score — a full voice, no more'] },
    { when: ['[600..849]'], then: [1.5, 'proven track record — support carries further'] },
    { when: ['>=850'], then: [2, 'top-tier reputation — capped at 2× so no side can pass a compromise alone'] },
  ],
}

/** A side's vote weight from its credit score. The table is the rule. */
export function debateWeight(creditScore: number): number {
  const out = evaluate(DEBATE_WEIGHT_TABLE, { creditScore })
  return Number(out?.weight ?? 1)
}

/**
 * When the argument is over, and what it was.
 *
 * Read top to bottom, FIRST hit wins. The ordering encodes the priorities: a
 * standing veto outranks everything (you do not get to declare consensus over
 * a red line), silence is never agreement (a consensus needs every side to
 * have actually spoken), and running out of rounds with points still open is
 * a deadlock — not a win for whoever spoke last.
 */
export const WARGAME_OUTCOME_TABLE: DecisionTable = {
  name: 'Wargame outcome',
  hitPolicy: 'FIRST',
  inputs: [
    { key: 'raised', label: 'Issues raised', type: 'number' },
    { key: 'blocks', label: 'Standing vetoes', type: 'number' },
    { key: 'open', label: 'Unresolved issues', type: 'number' },
    { key: 'accepted', label: 'Accepted amendments', type: 'number' },
    { key: 'stalled', label: 'Rounds without movement', type: 'number' },
    { key: 'roundsLeft', label: 'Rounds left', type: 'number' },
    { key: 'silent', label: 'Sides that never moved', type: 'number' },
  ],
  outputs: [
    { key: 'outcome', label: 'Outcome' },
    { key: 'reason', label: 'Why' },
  ],
  rules: [
    { when: ['0', '-', '-', '-', '-', '>0', '-'], then: ['continue', 'nothing contested yet — the sides have not opened'] },
    { when: ['0', '-', '-', '-', '-', '<=0', '-'], then: ['deadlock', 'no side raised a single point — there was no deliberation to settle'] },
    { when: ['-', '>0', '-', '-', '>=2', '-', '-'], then: ['blocked', 'a veto stood through two rounds in which nobody moved'] },
    { when: ['-', '>0', '-', '-', '-', '<=0', '-'], then: ['blocked', 'the rounds ran out with a veto still standing'] },
    { when: ['-', '>0', '-', '-', '-', '-', '-'], then: ['continue', 'a veto is on the table — the sides keep negotiating to lift it'] },
    { when: ['-', '0', '0', '0', '-', '<=0', '>0'], then: ['deadlock', 'nothing was left contested, but a side never moved — silence is not agreement'] },
    { when: ['-', '0', '0', '0', '>=2', '-', '>0'], then: ['deadlock', 'nothing was left contested, but a side never moved — silence is not agreement'] },
    { when: ['-', '0', '0', '0', '-', '-', '0'], then: ['consensus', 'every side spoke and every contested point was argued to agreement, unamended'] },
    { when: ['-', '0', '0', '>0', '-', '-', '-'], then: ['compromise', 'every point settled, some by amendments the table accepted'] },
    { when: ['-', '0', '>0', '-', '>=2', '-', '-'], then: ['deadlock', 'two rounds of argument moved nothing — the sides are talking past each other'] },
    { when: ['-', '0', '>0', '-', '-', '<=0', '-'], then: ['deadlock', 'the rounds ran out with points still contested'] },
    { when: ['-', '-', '-', '-', '-', '-', '-'], then: ['continue', 'points remain open and rounds remain — keep arguing'] },
  ],
}

/** The authoritative call, consulted by the runner after every round, so the
 *  printed table IS the running rule (same contract as decideAutoRelease). */
export function decideWargameOutcome(state: WargameState): { outcome: WargameOutcome; reason: string } {
  const out = evaluate(WARGAME_OUTCOME_TABLE, {
    raised: state.issues.length,
    blocks: blockedIssues(state).length,
    open: openIssues(state).length,
    accepted: acceptedAmendments(state).length,
    stalled: stalledRounds(state),
    roundsLeft: state.maxRounds - state.round,
    silent: silentSides(state).length,
  })
  return {
    outcome: (out?.outcome as WargameOutcome) ?? 'continue',
    reason: (out?.reason as string) ?? 'no matching rule — the argument continues',
  }
}

// --- Settlement -----------------------------------------------------------

/** The mechanical merge: the original proposal, then every accepted amendment
 *  in acceptance order. Honest about what it is — no LLM is involved, so
 *  nothing here can quietly rewrite what the sides agreed to. */
export function renderRevision(state: WargameState): string {
  const accepted = acceptedAmendments(state)
  if (accepted.length === 0) return state.proposal
  const lines = [state.proposal.trim(), '', '## Accepted amendments', '']
  accepted.forEach((a, i) => {
    const issue = state.issues.find((x) => x.id === a.issue)
    const by = state.sides.find((s) => s.id === a.side)?.label ?? a.side
    lines.push(`${i + 1}. **${issue?.title ?? a.issue}** — proposed by ${by}, ${Math.round(a.support * 100)}% of the table`)
    lines.push('')
    lines.push(a.text.trim())
    lines.push('')
  })
  return lines.join('\n').trim() + '\n'
}

export function settle(state: WargameState): WargameSettlement {
  const { outcome, reason } = decideWargameOutcome(state)
  const open = openIssues(state)
  const minorityReport: WargameSettlement['minorityReport'] = []

  for (const issue of state.issues) {
    const status = issueStatus(state, issue)
    if (status === 'agreed' || status === 'compromise') continue
    for (const b of activeBlocks(issue)) {
      minorityReport.push({ side: b.side, issue: issue.title, claim: b.claim, kind: 'block' })
    }
    for (const p of issue.positions) {
      if (p.conceded) continue
      minorityReport.push({ side: p.side, issue: issue.title, claim: p.claim, kind: 'position' })
    }
  }

  return {
    outcome,
    reason,
    revision: renderRevision(state),
    acceptedAmendments: acceptedAmendments(state),
    openIssues: open,
    minorityReport,
    convergence: convergence(state),
    rounds: state.round,
  }
}

// --- Projections ----------------------------------------------------------

const STATUS_MARK: Record<IssueStatus, string> = {
  agreed: 'AGREED',
  compromise: 'COMPROMISE',
  blocked: 'VETOED',
  open: 'OPEN',
}

/**
 * The compact board handed to every side as its briefing for the next round —
 * who holds what, what has been amended, what is still contested. Built from
 * already-sanitized claims (see safeClaim), so no participant's text can forge
 * a row of it.
 */
export function renderIssueBoard(state: WargameState): string {
  if (state.issues.length === 0) return '(no contested points raised yet)'
  const label = (id: string) => state.sides.find((s) => s.id === id)?.label ?? id
  const out: string[] = []
  for (const issue of state.issues) {
    const status = issueStatus(state, issue)
    out.push(`[${issue.id}] ${issue.title} — ${STATUS_MARK[status]}`)
    for (const p of issue.positions) {
      out.push(`  ${p.conceded ? 'conceded' : 'holds'}: ${label(p.side)} — ${p.claim}`)
    }
    for (const b of issue.blocks) {
      out.push(`  ${b.lifted ? 'veto lifted' : 'VETO'}: ${label(b.side)} — ${b.claim}`)
    }
    for (const a of state.amendments.filter((x) => x.issue === issue.id)) {
      const backers = [a.side, ...a.supporters].map(label).join(', ')
      out.push(
        `  amendment ${a.id} by ${label(a.side)} (${Math.round(a.support * 100)}% backing: ${backers})${a.accepted ? ' — ACCEPTED' : ''}: ${oneLine(a.text).slice(0, 160)}`,
      )
    }
  }
  return out.join('\n')
}

/** The full readable record — the artifact a human (or an auditor) reads to
 *  see how the outcome was actually reached. A projection of the JSON state,
 *  never the source of truth. */
export function transcriptToMarkdown(state: WargameState, settlement?: WargameSettlement): string {
  const label = (id: string) => state.sides.find((s) => s.id === id)?.label ?? id
  const s = settlement ?? settle(state)
  const out: string[] = [
    '# Wargame',
    '',
    '## Proposal',
    '',
    state.proposal.trim(),
    '',
    '## Sides',
    '',
    ...state.sides.map((x) => `- **${x.label}** (weight ${x.weight ?? 1}) — ${x.mandate}`),
    '',
    '## Rounds',
    '',
  ]

  for (const round of state.transcript) {
    out.push(`### Round ${round.round} — ${round.movement} state-changing move(s)`)
    out.push('')
    if (round.moves.length === 0) out.push('_(no moves)_')
    for (const m of round.moves) {
      const target = m.target ? ` → ${label(m.target)}` : m.amendmentId ? ` → ${m.amendmentId}` : ''
      out.push(`- **${label(m.side)}** \`${m.kind}\` [${m.issue}]${target}: ${m.claim || m.amendment || ''}`)
    }
    out.push('')
  }

  out.push('## Board', '', '```', renderIssueBoard(state), '```', '')
  out.push(`## Outcome: ${s.outcome.toUpperCase()}`, '', s.reason, '')
  out.push(`Convergence ${Math.round(s.convergence * 100)}% over ${s.rounds} round(s).`, '')

  if (s.minorityReport.length > 0) {
    out.push('### Minority report', '')
    for (const d of s.minorityReport) {
      out.push(`- **${label(d.side)}** (${d.kind === 'block' ? 'veto' : 'dissent'}) on _${d.issue}_: ${d.claim}`)
    }
    out.push('')
  }

  return out.join('\n').trim() + '\n'
}
