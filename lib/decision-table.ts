/**
 * A tiny DMN-style decision table — the trust gates ("when does escrow
 * auto-release?", "how high is a worker's ceiling?") as readable, auditable
 * rules instead of logic scattered across the settlement code.
 *
 * This is a PROJECTION, in the same spirit as the collab DSL: JSON/code stays
 * the substrate, this rides on top as the human-facing decision layer — but
 * the auto-release table is also the ACTUAL authority the settlement path
 * consults (see lib/labor-settle.ts), so the printed table and the running
 * rule can never drift.
 *
 * Deliberately not a full DMN/FEEL engine (that's a heavyweight standard). A
 * cell is one of: '-' (any), a comparison (>=600, <=50, >0, <5), a range
 * ([600..825]), or a literal (pass, true, 42). Hit policy FIRST — the first
 * matching rule wins, top to bottom. Pure and dependency-free.
 */

export type InputType = 'number' | 'string' | 'boolean'

export interface DecisionTable {
  name: string
  hitPolicy: 'FIRST'
  inputs: { key: string; label: string; type: InputType }[]
  outputs: { key: string; label: string }[]
  /** `when` aligns to `inputs`, `then` aligns to `outputs`. */
  rules: { when: string[]; then: (string | number)[] }[]
}

function matchCell(cell: string, value: unknown, type: InputType): boolean {
  const c = cell.trim()
  if (c === '-' || c === '') return true
  if (type === 'number') {
    const n = Number(value)
    let m: RegExpMatchArray | null
    if ((m = c.match(/^(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)$/))) {
      const t = Number(m[2])
      return m[1] === '>=' ? n >= t : m[1] === '<=' ? n <= t : m[1] === '>' ? n > t : n < t
    }
    if ((m = c.match(/^\[\s*(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)\s*\]$/))) {
      return n >= Number(m[1]) && n <= Number(m[2])
    }
    return n === Number(c)
  }
  if (type === 'boolean') return String(value) === c
  return String(value) === c
}

/** Evaluate the table against a set of inputs. Returns the matched rule's
 *  outputs (keyed by output key), or null when nothing matches. */
export function evaluate(table: DecisionTable, inputs: Record<string, unknown>): Record<string, string | number> | null {
  for (const rule of table.rules) {
    const hit = table.inputs.every((inp, i) => matchCell(rule.when[i] ?? '-', inputs[inp.key], inp.type))
    if (hit) {
      const out: Record<string, string | number> = {}
      table.outputs.forEach((o, i) => (out[o.key] = rule.then[i]))
      return out
    }
  }
  return null
}

/** Render a table as GitHub-flavored markdown — the auditable artifact. */
export function decisionTableToMarkdown(table: DecisionTable): string {
  const cols = [...table.inputs.map((i) => i.label), ...table.outputs.map((o) => o.label)]
  const head = `| ${cols.join(' | ')} |`
  const sep = `| ${cols.map(() => '---').join(' | ')} |`
  const rows = table.rules.map((r) => `| ${[...r.when, ...r.then.map(String)].join(' | ')} |`)
  return [`### ${table.name}`, '', head, sep, ...rows].join('\n')
}

// --- The real trust gates -------------------------------------------------

// Mirrors AUTO_APPROVE_MAX_BOUNTY_USD (50) + reputation-lending DEFAULT_TERMS
// (minScore 600, baseLimit $5, perPoint $0.20, maxLimit $100). Kept here as
// the readable ceiling; the exact figure is computed by reputationCapUsd.
const BASE_CAP_USD = 50
const MIN_SCORE = 600
const BASE_LIMIT_USD = 5
const PER_POINT_USD = 0.2
const MAX_LIMIT_USD = 100

/** A worker's auto-release ceiling given its credit score — base cap, raised
 *  by verified reputation, bounded by the max limit. */
export function reputationCapUsd(score: number): number {
  const rep = score >= MIN_SCORE ? Math.min(MAX_LIMIT_USD, Math.max(0, BASE_LIMIT_USD + (score - MIN_SCORE) * PER_POINT_USD)) : 0
  return Math.max(BASE_CAP_USD, rep)
}

/** How high a worker's escrow auto-releases without human review. */
export const CREDIT_CEILING_TABLE: DecisionTable = {
  name: 'Auto-release ceiling by reputation',
  hitPolicy: 'FIRST',
  inputs: [{ key: 'creditScore', label: 'Credit score', type: 'number' }],
  outputs: [
    { key: 'ceiling', label: 'Auto-release ceiling' },
    { key: 'note', label: 'Why' },
  ],
  rules: [
    { when: ['<600'], then: ['$50', 'base ceiling — below the minimum reputation score (600)'] },
    { when: ['[600..825]'], then: ['$50', 'reputation earned, still under the base ceiling'] },
    { when: ['[826..1074]'], then: ['$5 + (score−600)×$0.20', 'reputation raises the ceiling above base'] },
    { when: ['>=1075'], then: ['$100', 'maximum reputation ceiling'] },
  ],
}

/** When graded work releases escrow automatically vs. waits for a human. */
export const AUTO_RELEASE_TABLE: DecisionTable = {
  name: 'Escrow settlement decision',
  hitPolicy: 'FIRST',
  inputs: [
    { key: 'verdict', label: 'Grader verdict', type: 'string' },
    { key: 'autoApprove', label: 'Requester auto-approve', type: 'boolean' },
    { key: 'withinCap', label: 'Bounty ≤ ceiling', type: 'boolean' },
    { key: 'repostsExhausted', label: 'Reposts used up', type: 'boolean' },
  ],
  outputs: [
    { key: 'action', label: 'Action' },
    { key: 'reason', label: 'Why' },
  ],
  rules: [
    { when: ['pending', '-', '-', '-'], then: ['wait', 'grading has not returned a verdict yet'] },
    { when: ['fail', '-', '-', 'false'], then: ['refund_repost', 'failed grading — escrow refunded and reposted to a different worker'] },
    { when: ['fail', '-', '-', 'true'], then: ['manual_review', 'failed grading and out of auto-reposts — sent to manual review'] },
    { when: ['pass', 'false', '-', '-'], then: ['manual_review', 'passed, but the requester turned auto-approve off'] },
    { when: ['pass', 'true', 'false', '-'], then: ['manual_review', 'passed, but the bounty exceeds this worker’s auto-release ceiling'] },
    { when: ['pass', 'true', 'true', '-'], then: ['auto_release', 'passed grading and within the ceiling — escrow released to the worker'] },
  ],
}

export type SettlementAction = 'wait' | 'refund_repost' | 'manual_review' | 'auto_release'

/** The authoritative auto-release decision — consulted by the settlement path
 *  (lib/labor-settle.ts) so the printed table IS the running rule. */
export function decideAutoRelease(input: {
  verdict: 'pass' | 'fail' | 'pending'
  autoApprove: boolean
  bountyUsd: number
  capUsd: number
  repostsExhausted?: boolean
}): { action: SettlementAction; reason: string } {
  const out = evaluate(AUTO_RELEASE_TABLE, {
    verdict: input.verdict,
    autoApprove: input.autoApprove,
    withinCap: input.bountyUsd <= input.capUsd,
    repostsExhausted: Boolean(input.repostsExhausted),
  })
  return {
    action: (out?.action as SettlementAction) ?? 'manual_review',
    reason: (out?.reason as string) ?? 'no matching rule — held for review',
  }
}
