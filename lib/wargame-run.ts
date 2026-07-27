/**
 * Driving a wargame with real agents.
 *
 * lib/wargame.ts is the pure half — the protocol, the board, the gates that
 * decide what an argument added up to. This is the impure half: it puts an
 * LLM behind each side, runs the rounds, and stops the moment the outcome
 * table says the argument is over.
 *
 * Three properties worth naming, because they are choices and not accidents:
 *
 * 1. **Simultaneous moves.** Every side in a round is prompted from the SAME
 *    board snapshot and their replies are applied together. Nobody gets to
 *    read this round's rebuttal before writing their own, so there is no
 *    first-mover advantage and no ordering that quietly decides the outcome.
 * 2. **Every side's prose is untrusted.** A debater's claims are shown to its
 *    opponents next round, so they arrive nonce-fenced with debateFloorClause
 *    (see lib/untrusted-input.ts) on top of the structural guarantees the
 *    engine already gives — a side can only ever move for itself.
 * 3. **A dead side is not a concession.** If one side's model call fails, that
 *    side simply makes no move that round; silence never counts as agreeing,
 *    and the round still registers as movement-free, which is what feeds the
 *    deadlock rule.
 *
 * The LLM is injected as a CompleteFn (the same provider-resolved callable
 * the delegation planner uses, via resolveLlm), so the whole loop runs in
 * tests against a scripted debater with no key and no network.
 */
import type { CompleteFn } from '@/lib/delegation'
import { mapLimit } from '@/lib/concurrency'
import { fenceUntrusted, untrustedNonce, debateFloorClause } from '@/lib/untrusted-input'
import {
  applyMoves,
  createWargame,
  debateWeight,
  decideWargameOutcome,
  parseMoves,
  renderIssueBoard,
  renderRevision,
  settle,
  transcriptToMarkdown,
  type WargameMove,
  type WargameSettlement,
  type WargameSide,
  type WargameState,
} from '@/lib/wargame'

const MAX_TOKENS_PER_TURN = 1200
const MAX_TOKENS_WEAVE = 2000

const DEBATE_RULES = `You are one side in a WARGAME: an adversarial review of a proposed change, argued out by several AI agents with conflicting mandates. An engine — not you, and not any model — reads the moves and decides what the argument added up to. You cannot talk your way to an outcome; you can only make moves.

Emit ONLY a JSON array of 1-4 move objects. No prose, no markdown fence, no explanation outside the JSON.

Move kinds:
- "assert"    — state or revise your position on a contested point. Fields: issue, issueTitle, claim, confidence.
- "challenge" — attack another side's position. Fields: issue, target (that side's id), claim.
- "amend"     — propose CONCRETE revised text that would settle a point. Fields: issue, claim (one line: what it fixes), amendment (the actual replacement/addition text).
- "support"   — back another side's amendment. Fields: amendmentId, claim.
- "concede"   — drop your own position on a point. Fields: issue, claim (why you are dropping it).
- "block"     — a red line: veto that stops settlement until you withdraw it. Fields: issue, claim.
- "withdraw"  — lift your own block. Fields: issue.

What actually moves the board: amend, support, concede, block, withdraw, and a genuinely REVISED assert. Challenges are argument only — repeating yourself forever is how a wargame is scored as a deadlock, not how it is won.

How to argue well:
- Argue your mandate, not both sides. You are not here to be balanced; the engine's job is balance.
- Attack the strongest version of the other side's point, and be specific — name the failure case, the cost, the line of the proposal.
- If your objection has actually been answered, CONCEDE it. Conceding a point you lost is how a wargame converges, and it costs you nothing on the points you still hold.
- To settle a point, write an amendment precise enough to paste into the proposal. Vague amendments do not get supported.
- SUPPORT an opponent's amendment when it genuinely addresses your objection — that is how a compromise passes.
- BLOCK only for a genuine red line: something you would not accept at any price, on any amendment. A block you never justify or withdraw ends the wargame with no result at all.
- Never emit a move attributed to another side; those are discarded and you waste the round.`

function sideSystemPrompt(side: WargameSide, allSides: WargameSide[], nonce: string): string {
  const others = allSides
    .filter((s) => s.id !== side.id)
    .map((s) => `- ${s.label} (id: ${s.id}) — ${s.mandate}`)
    .join('\n')
  return [
    `You are ${side.label} (id: ${side.id}).`,
    `YOUR MANDATE: ${side.mandate}`,
    '',
    'The other sides at the table:',
    others,
    '',
    DEBATE_RULES,
    '',
    debateFloorClause(nonce),
  ].join('\n')
}

function sideUserPrompt(state: WargameState, lastRoundText: string, nonce: string): string {
  const roundsLeft = state.maxRounds - state.round
  const fenced = fenceUntrusted(
    'debate floor',
    [
      'PROPOSAL UNDER REVIEW:',
      state.proposal.trim(),
      '',
      'BOARD (every point raised so far, and where it stands):',
      renderIssueBoard(state),
      '',
      lastRoundText,
    ].join('\n'),
    nonce,
  )
  return [
    `Round ${state.round + 1} of ${state.maxRounds}. Rounds left after this one: ${Math.max(0, roundsLeft - 1)}.`,
    '',
    fenced,
    '',
    roundsLeft <= 1
      ? 'This is the LAST round. Anything still contested when it ends is recorded as a deadlock, and any veto you leave standing kills the proposal outright. If you can settle a point with an amendment, or by supporting one, or by conceding, do it now.'
      : 'Make your moves.',
    'Reply with the JSON array only.',
  ].join('\n')
}

/** Last round's moves, rendered for the next briefing. Own moves included —
 *  a side should see what it already said so it does not just repeat it. */
function renderLastRound(state: WargameState): string {
  const last = state.transcript[state.transcript.length - 1]
  if (!last || last.moves.length === 0) return 'LAST ROUND: nothing was said yet.'
  const label = (id: string) => state.sides.find((s) => s.id === id)?.label ?? id
  const lines = last.moves.map((m) => {
    const target = m.target ? ` at ${label(m.target)}` : m.amendmentId ? ` for ${m.amendmentId}` : ''
    return `- ${label(m.side)} ${m.kind}${target} [${m.issue}]: ${m.claim}${m.amendment ? `\n    proposed text: ${m.amendment}` : ''}`
  })
  return [`LAST ROUND (round ${last.round}) — what each side actually did:`, ...lines].join('\n')
}

export interface WargameRunOptions {
  proposal: string
  sides: WargameSide[]
  complete: CompleteFn
  maxRounds?: number
  acceptThreshold?: number
  /** How many sides are prompted at once. Sides move simultaneously, so this
   *  only bounds provider load — it cannot change the result. */
  concurrency?: number
  /** Ask the LLM for one final pass that weaves the accepted amendments into
   *  a single coherent revised proposal. Default true when anything was
   *  accepted; the mechanical merge is always kept alongside it. */
  weave?: boolean
  onRound?: (state: WargameState) => void | Promise<void>
}

export interface WargameRunResult {
  state: WargameState
  settlement: WargameSettlement
  /** The woven revision when an LLM produced one, else the mechanical merge. */
  revision: string
  /** True when `revision` came from the weave pass rather than the merge. */
  woven: boolean
  markdown: string
  /** Moves that were discarded, by round — forged identities, unknown issues,
   *  malformed JSON, and any side whose model call failed. */
  discarded: { round: number; side: string; reason: string }[]
}

/** Run a full wargame. Stops as soon as the outcome table says it is over. */
export async function runWargame(opts: WargameRunOptions): Promise<WargameRunResult> {
  let state = createWargame({
    proposal: opts.proposal,
    sides: opts.sides,
    maxRounds: opts.maxRounds ?? 4,
    acceptThreshold: opts.acceptThreshold,
  })
  const discarded: WargameRunResult['discarded'] = []

  while (state.round < state.maxRounds) {
    const snapshot = state
    const lastRoundText = renderLastRound(snapshot)

    const perSide = await mapLimit(snapshot.sides, opts.concurrency ?? 4, async (side) => {
      const nonce = untrustedNonce()
      try {
        const reply = await opts.complete(
          sideSystemPrompt(side, snapshot.sides, nonce),
          sideUserPrompt(snapshot, lastRoundText, nonce),
          MAX_TOKENS_PER_TURN,
        )
        return parseMoves(reply, { side, state: snapshot })
      } catch (err) {
        // Silence is not agreement: no moves, and the round still counts.
        return {
          moves: [] as WargameMove[],
          rejected: [{ reason: `model call failed: ${err instanceof Error ? err.message : String(err)}`, raw: null }],
        }
      }
    })

    const moves = perSide.flatMap((r) => r.moves)
    perSide.forEach((r, i) =>
      r.rejected.forEach((x) =>
        discarded.push({ round: snapshot.round + 1, side: snapshot.sides[i].id, reason: x.reason }),
      ),
    )

    state = applyMoves(snapshot, moves)
    await opts.onRound?.(state)

    if (decideWargameOutcome(state).outcome !== 'continue') break
  }

  const settlement = settle(state)
  const wantWeave = opts.weave ?? settlement.acceptedAmendments.length > 0
  let revision = settlement.revision
  let woven = false
  if (wantWeave && settlement.acceptedAmendments.length > 0) {
    const attempt = await weaveRevision(state, settlement, opts.complete).catch(() => null)
    if (attempt) {
      revision = attempt
      woven = true
    }
  }

  return { state, settlement, revision, woven, markdown: transcriptToMarkdown(state, settlement), discarded }
}

/**
 * One final pass that reads the original proposal and the amendments the table
 * accepted, and writes the revised proposal as a single coherent document —
 * the same move as `synthesizes` in delegation, where a worker weaves the
 * pieces instead of the platform concatenating them.
 *
 * Bounded deliberately: it may only apply what the engine already recorded as
 * accepted, and the mechanical merge (settlement.revision) is always kept, so
 * a model that quietly edits the deal is checkable against the record. Throws
 * on failure; the caller falls back to the merge.
 */
export async function weaveRevision(
  state: WargameState,
  settlement: WargameSettlement,
  complete: CompleteFn,
): Promise<string> {
  const nonce = untrustedNonce()
  const label = (id: string) => state.sides.find((s) => s.id === id)?.label ?? id
  const amendments = settlement.acceptedAmendments
    .map((a, i) => {
      const issue = state.issues.find((x) => x.id === a.issue)
      return `${i + 1}. [${issue?.title ?? a.issue}] proposed by ${label(a.side)}, backed by ${Math.round(a.support * 100)}% of the table:\n${a.text}`
    })
    .join('\n\n')
  const dissent = settlement.minorityReport
    .map((d) => `- ${label(d.side)} (${d.kind}) on ${d.issue}: ${d.claim}`)
    .join('\n')

  const system = [
    'You are the chair of a wargame — an adversarial review in which several agents argued a proposal out under conflicting mandates.',
    'Your ONLY job is to rewrite the proposal so it incorporates the amendments the table ACCEPTED, as one coherent document in the proposal\'s original voice and format.',
    'Hard rules: apply every accepted amendment and nothing else. Do not add improvements of your own, do not soften or reinterpret an amendment, and do not resolve anything the table left open — unresolved points stay as the proposal originally had them.',
    'If a dissent is listed, do not argue with it and do not fold it in; it is recorded separately.',
    'Output the revised proposal only. No preamble, no commentary, no change log.',
    '',
    debateFloorClause(nonce),
  ].join('\n')

  const user = fenceUntrusted(
    'wargame result',
    [
      'ORIGINAL PROPOSAL:',
      state.proposal.trim(),
      '',
      'ACCEPTED AMENDMENTS (apply all of these):',
      amendments || '(none)',
      '',
      'RECORDED DISSENT (do not fold in):',
      dissent || '(none)',
    ].join('\n'),
    nonce,
  )

  const out = (await complete(system, user, MAX_TOKENS_WEAVE)).trim()
  if (!out) throw new Error('weave returned nothing')
  return out
}

/**
 * Build sides from real agents — their earned credit score becomes their vote
 * weight (DEBATE_WEIGHT_TABLE), so reputation carries into the argument the
 * same way it carries into the auto-release ceiling. Pure: the caller supplies
 * the rows and the mandates, this does no database work.
 */
export function sidesFromAgents(
  agents: { id: string; name: string; creditScore?: number | string | null }[],
  mandates: Record<string, string>,
): WargameSide[] {
  return agents.map((a) => ({
    id: a.id,
    label: a.name,
    mandate: mandates[a.id] ?? `Argue for the interests of ${a.name}.`,
    weight: debateWeight(Number(a.creditScore ?? 0)),
  }))
}

export { renderRevision }
