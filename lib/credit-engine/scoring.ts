/**
 * Credit Scoring Engine — pure calculation layer.
 *
 * Converts an agent's behavioral event history into economic trust.
 * No I/O happens here; persistence lives in lib/credit-engine/index.ts
 * and API routes only orchestrate. This module is the single source of
 * truth for the financial logic.
 *
 * Formula (weights fixed by product spec):
 *   Performance  40%  — task success rate, output quality, completed volume
 *   Reliability  30%  — quality consistency, recent failure frequency, SLA compliance
 *   Reputation   20%  — verified achievements, accumulated successful interactions
 *   Risk         10%  — failures, abnormal behavior, small-sample uncertainty
 *
 * Each factor is scored 0–100, dampened toward the neutral value (50)
 * while the sample is small (an agent must EARN certainty), then combined
 * into a composite that maps onto a 300–990 credit score.
 */

export type AgentEventInput = {
  eventType: string
  success: boolean
  executionTime: number // seconds
  tokenCost: number
  qualityScore: number | null // 0–1
  createdAt: Date
}

export type CreditAssessment = {
  score: number // 300–990
  rating: Rating
  creditLimit: number // USD
  riskLevel: RiskLevel
  breakdown: {
    performance: number
    reliability: number
    reputation: number
    risk: number
    composite: number
    completedTasks: number
    failedTasks: number
    successRate: number // 0–1
    avgQuality: number // 0–1
  }
}

export type Rating = 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'C' | 'D'
export type RiskLevel = 'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH'

/** Tasks slower than this breach the SLA used for reliability scoring. */
const SLA_SECONDS = 120
/** Recent window (task count) used for failure-frequency scoring. */
const RECENT_WINDOW = 20
/** Sample size at which factor scores carry ~2/3 of their raw weight. */
const CONFIDENCE_K = 5

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v))

/** Shrink a raw 0–100 factor toward neutral 50 while the sample is small. */
function dampen(raw: number, sampleSize: number): number {
  const confidence = sampleSize / (sampleSize + CONFIDENCE_K)
  return 50 + (raw - 50) * confidence
}

export function assessCredit(
  events: AgentEventInput[],
  rules?: { rating?: ScoreRule<Rating>[]; risk?: ScoreRule<RiskLevel>[] },
): CreditAssessment {
  // Terminal task events are the unit of behavioral history. Two grades of
  // signal: self-evaluated (TASK_*, the runtime grading its own output) and
  // ground-truth verified (VERIFIED_TASK_*, graded server-side against a
  // hidden answer and settled by escrow). Verified events are facts; the
  // self-evaluated ones are opinions and carry less reputational weight.
  const TERMINAL_SUCCESS = new Set(['TASK_COMPLETED', 'VERIFIED_TASK_COMPLETED'])
  const TERMINAL = new Set([...TERMINAL_SUCCESS, 'TASK_FAILED', 'VERIFIED_TASK_FAILED'])
  const isSuccess = (t: AgentEventInput) => TERMINAL_SUCCESS.has(t.eventType) && t.success

  const tasks = events
    .filter((e) => TERMINAL.has(e.eventType))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  const completed = tasks.filter(isSuccess)
  const failed = tasks.filter((t) => !isSuccess(t))
  const n = tasks.length

  // Cold start: no behavioral history means no credit. Dampening pulls
  // factors toward neutral, but an agent with zero recorded tasks must
  // start at the floor and earn its way up.
  if (n === 0) {
    return {
      score: 300,
      rating: 'D',
      creditLimit: 0,
      riskLevel: 'HIGH',
      breakdown: {
        performance: 0,
        reliability: 0,
        reputation: 0,
        risk: 0,
        composite: 0,
        completedTasks: 0,
        failedTasks: 0,
        successRate: 0,
        avgQuality: 0,
      },
    }
  }

  const successRate = n > 0 ? completed.length / n : 0
  const qualities = completed
    .map((t) => t.qualityScore)
    .filter((q): q is number => q !== null)
  const avgQuality = qualities.length > 0 ? qualities.reduce((a, b) => a + b, 0) / qualities.length : 0

  // ── Performance (40%) ────────────────────────────────────────────
  // Volume is log-scaled: the 10th task proves more than the 1000th.
  const volumeScore = clamp(Math.log10(completed.length + 1) * 50)
  const performance = dampen(
    clamp(0.5 * successRate * 100 + 0.35 * avgQuality * 100 + 0.15 * volumeScore),
    n,
  )

  // ── Reliability (30%) ────────────────────────────────────────────
  // Consistency: low variance in output quality signals a stable agent.
  const meanQ = avgQuality
  const variance =
    qualities.length > 1
      ? qualities.reduce((a, q) => a + (q - meanQ) ** 2, 0) / qualities.length
      : 0
  const consistency = clamp(100 - Math.sqrt(variance) * 250)

  // Failure frequency over the recent window (recency matters for trust).
  const recent = tasks.slice(-RECENT_WINDOW)
  const recentFailures = recent.filter((t) => !isSuccess(t)).length
  const failureFrequency = recent.length > 0 ? clamp(100 * (1 - recentFailures / recent.length)) : 0

  // SLA compliance: share of tasks finishing within the SLA budget.
  const slaCompliance =
    n > 0 ? clamp((tasks.filter((t) => t.executionTime <= SLA_SECONDS).length / n) * 100) : 0

  // Payment history: on-time repayments vs defaults. Neutral (50) until
  // the agent has actually borrowed and repaid at least once.
  const repaymentEvents = events.filter(
    (e) => e.eventType === 'REPAYMENT_COMPLETED' || e.eventType === 'REPAYMENT_DEFAULTED',
  ).length
  const repaymentsCount = events.filter((e) => e.eventType === 'REPAYMENT_COMPLETED').length
  const paymentHistory =
    repaymentEvents > 0 ? clamp((repaymentsCount / repaymentEvents) * 100) : 50

  const reliability = dampen(
    clamp(0.3 * consistency + 0.3 * failureFrequency + 0.2 * slaCompliance + 0.2 * paymentHistory),
    n + repaymentEvents,
  )

  // Credit-repayment behavior — the other half of "scale": an agent that
  // draws credit and repays on time proves creditworthiness directly.
  const repayments = events.filter((e) => e.eventType === 'REPAYMENT_COMPLETED').length
  const defaults = events.filter((e) => e.eventType === 'REPAYMENT_DEFAULTED').length

  // Completed paid jobs on the labor market — real economic activity, the
  // strongest reputation signal an agent can accumulate.
  const jobsCompleted = events.filter((e) => e.eventType === 'JOB_COMPLETED').length

  // ── Reputation (20%) ─────────────────────────────────────────────
  // Verified achievements are explicit third-party attestations; the rest
  // accrues from the volume of successful interactions — repaid credit and,
  // most of all, delivered paid work.
  const achievements = events.filter((e) => e.eventType === 'ACHIEVEMENT_VERIFIED').length
  const verifiedCompleted = events.filter((e) => e.eventType === 'VERIFIED_TASK_COMPLETED').length
  // Acceptance tests on code jobs, run by the platform runtime (grader ≠
  // solver) — a fact, same trust class as VERIFIED_TASK_*. Supplementary to
  // the run's own terminal event, so they don't join TERMINAL above.
  const testsPassed = events.filter((e) => e.eventType === 'JOB_TESTS_PASSED').length
  const testsFailed = events.filter((e) => e.eventType === 'JOB_TESTS_FAILED').length
  const reputation = dampen(
    clamp(
      Math.log10(completed.length + 1) * 35 +
        achievements * 10 +
        repayments * 8 +
        jobsCompleted * 12 +
        verifiedCompleted * 10 + // ground-truth-verified capability
        testsPassed * 10, // independently test-verified deliverables
    ),
    n + achievements + repayments + jobsCompleted + testsPassed,
  )

  // ── Risk (10%) — higher is safer ─────────────────────────────────
  // Defaults are the strongest negative credit signal, weighted above task
  // failures. A deliverable that failed the requester's acceptance tests is
  // a confident-but-wrong fact — riskier than an honest task failure.
  const anomalies = events.filter((e) => e.eventType.includes('ANOMALY')).length
  const risk = dampen(
    clamp(100 - failed.length * 8 - anomalies * 15 - defaults * 25 - testsFailed * 10),
    n + defaults + testsFailed,
  )

  // ── Composite → score ────────────────────────────────────────────
  const composite = 0.4 * performance + 0.3 * reliability + 0.2 * reputation + 0.1 * risk
  const score = Math.round(300 + composite * 6.9) // 300 (floor) – 990 (ceiling)

  return {
    score,
    rating: ratingForScore(score, rules?.rating),
    creditLimit: creditLimitForScore(score),
    riskLevel: riskLevelForScore(score, rules?.risk),
    breakdown: {
      performance: Math.round(performance * 10) / 10,
      reliability: Math.round(reliability * 10) / 10,
      reputation: Math.round(reputation * 10) / 10,
      risk: Math.round(risk * 10) / 10,
      composite: Math.round(composite * 10) / 10,
      completedTasks: completed.length,
      failedTasks: failed.length,
      successRate: Math.round(successRate * 1000) / 1000,
      avgQuality: Math.round(avgQuality * 1000) / 1000,
    },
  }
}

/** A DMN-style decision-table row: "score >= minScore -> value". Rows are
 *  evaluated highest minScore first; the first match wins. */
export type ScoreRule<T extends string> = { minScore: number; value: T }

export const RATINGS: Rating[] = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'C', 'D']
export const RISK_LEVELS: RiskLevel[] = ['LOW', 'MODERATE', 'ELEVATED', 'HIGH']

/** The thresholds this file shipped with — used until an admin overrides
 *  them via the credit rating policy editor (/admin/credit-rules). */
export const DEFAULT_RATING_RULES: ScoreRule<Rating>[] = [
  { minScore: 900, value: 'AAA' },
  { minScore: 840, value: 'AA' },
  { minScore: 760, value: 'A' },
  { minScore: 680, value: 'BBB' },
  { minScore: 600, value: 'BB' },
  { minScore: 520, value: 'B' },
  { minScore: 440, value: 'C' },
]

export const DEFAULT_RISK_RULES: ScoreRule<RiskLevel>[] = [
  { minScore: 800, value: 'LOW' },
  { minScore: 680, value: 'MODERATE' },
  { minScore: 560, value: 'ELEVATED' },
]

export function ratingForScore(score: number, rules: ScoreRule<Rating>[] = DEFAULT_RATING_RULES): Rating {
  const hit = [...rules].sort((a, b) => b.minScore - a.minScore).find((r) => score >= r.minScore)
  return hit?.value ?? 'D' // fail to the safest (lowest) rating, never "no rating"
}

/**
 * Programmable credit limit, quadratic above the lending floor:
 *   limit = (score − 500)² / 5.625, rounded to $250.
 * e.g. score 875 → $25,000; score 990 → $42,750; below 520 → $0.
 */
export function creditLimitForScore(score: number): number {
  if (score < 520) return 0
  return Math.round((score - 500) ** 2 / 5.625 / 250) * 250
}

export function riskLevelForScore(score: number, rules: ScoreRule<RiskLevel>[] = DEFAULT_RISK_RULES): RiskLevel {
  const hit = [...rules].sort((a, b) => b.minScore - a.minScore).find((r) => score >= r.minScore)
  return hit?.value ?? 'HIGH' // fail to the safest (most conservative) risk level
}

/** Human-readable explanation of a score change, stored with each entry. */
export function buildCalculationReason(
  next: CreditAssessment,
  previousScore: number | null,
): string {
  const b = next.breakdown
  const parts = [
    previousScore === null
      ? `Initial assessment: ${next.score}`
      : `Score ${previousScore} → ${next.score}`,
    `${b.completedTasks} completed / ${b.failedTasks} failed tasks (success rate ${(b.successRate * 100).toFixed(1)}%)`,
    `avg output quality ${(b.avgQuality * 100).toFixed(0)}%`,
    `factors — performance ${b.performance}, reliability ${b.reliability}, reputation ${b.reputation}, risk ${b.risk}`,
  ]
  return parts.join('; ')
}
