/**
 * Issue #6 — a self/sibling-graded quality_score bought as much of the
 * Performance factor as a ground-truth-verified one.
 *
 * `TASK_COMPLETED`'s qualityScore is `evaluator_node` in
 * agent-runtime/runtime/graph.py grading its own model's own output — no
 * ground truth, no independent party. `VERIFIED_TASK_COMPLETED`'s is settled
 * server-side against a hidden answer (`settleVerifiedTask`). Before this fix
 * the two were averaged into `avgQuality` unweighted, so a fluently
 * confident-but-wrong self-grade counted exactly as much toward the
 * 40%-weighted Performance factor as a verified pass.
 *
 * The fix is the same principle GRADER_WEIGHTS already applies one level up
 * (a colluding requester's own criteria count for less): a signal an
 * interested party issued about itself is discounted relative to one an
 * independent process settled.
 */
import { describe, expect, it } from 'vitest'
import { assessCredit, type AgentEventInput } from '@/lib/credit-engine/scoring'

const at = (i: number) => new Date(Date.UTC(2026, 6, 1, i))
const NOW = at(1000)

const selfGraded = (i: number, quality: number): AgentEventInput => ({
  eventType: 'TASK_COMPLETED',
  success: true,
  executionTime: 1,
  tokenCost: 0,
  qualityScore: quality,
  createdAt: at(i),
})

const verified = (i: number, quality: number): AgentEventInput => ({
  eventType: 'VERIFIED_TASK_COMPLETED',
  success: true,
  executionTime: 1,
  tokenCost: 0,
  qualityScore: quality,
  createdAt: at(i),
})

describe('self-graded quality is discounted relative to verified quality', () => {
  it('the SAME quality score produces a lower Performance factor when self-graded', () => {
    const n = 20
    const selfEvents = Array.from({ length: n }, (_, i) => selfGraded(i, 0.95))
    const verifiedEvents = Array.from({ length: n }, (_, i) => verified(i, 0.95))

    const selfResult = assessCredit(selfEvents, undefined, NOW)
    const verifiedResult = assessCredit(verifiedEvents, undefined, NOW)

    // Same event count, same success rate, same raw quality number, same
    // volume — the only thing that differs is who issued the quality score.
    expect(selfResult.breakdown.completedTasks).toBe(verifiedResult.breakdown.completedTasks)
    expect(selfResult.breakdown.successRate).toBe(verifiedResult.breakdown.successRate)
    expect(selfResult.breakdown.performance).toBeLessThan(verifiedResult.breakdown.performance)
    // avgQuality itself is now the WEIGHTED figure, so it reads lower too —
    // the score a reader sees on the dashboard already reflects the discount
    // rather than hiding it inside an opaque performance number.
    expect(selfResult.breakdown.avgQuality).toBeLessThan(verifiedResult.breakdown.avgQuality)
    expect(selfResult.score).toBeLessThan(verifiedResult.score)
  })

  it('a mix of self-graded and verified completions lands strictly between the two pure cases', () => {
    const n = 20
    const pureSelf = assessCredit(
      Array.from({ length: n }, (_, i) => selfGraded(i, 0.9)),
      undefined,
      NOW,
    )
    const pureVerified = assessCredit(
      Array.from({ length: n }, (_, i) => verified(i, 0.9)),
      undefined,
      NOW,
    )
    const half = assessCredit(
      Array.from({ length: n }, (_, i) => (i % 2 === 0 ? selfGraded(i, 0.9) : verified(i, 0.9))),
      undefined,
      NOW,
    )
    expect(half.breakdown.performance).toBeGreaterThan(pureSelf.breakdown.performance)
    expect(half.breakdown.performance).toBeLessThan(pureVerified.breakdown.performance)
  })

  it('does not touch success rate or volume — completing self-graded work still counts as completing work', () => {
    const n = 15
    const selfResult = assessCredit(
      Array.from({ length: n }, (_, i) => selfGraded(i, 0.5)),
      undefined,
      NOW,
    )
    // successRate = completed/total = 1 either way; volume is log-scaled off
    // completed.length, also identical. Only the quality contribution moved.
    expect(selfResult.breakdown.successRate).toBe(1)
    expect(selfResult.breakdown.completedTasks).toBe(n)
  })

  it('shrinks a self-graded score toward neutral rather than leaving it unweighted', () => {
    // The number a reader actually sees on the dashboard: a self-reported
    // 0.95 should read as noticeably less than 0.95 once discounted — this is
    // what a normalized weighted average silently failed to do (see the
    // comment in scoring.ts) because it vanishes on a uniform population.
    const allSelf = assessCredit(
      Array.from({ length: 20 }, (_, i) => selfGraded(i, 0.95)),
      undefined,
      NOW,
    )
    expect(allSelf.breakdown.avgQuality).toBeLessThan(0.95)
    expect(allSelf.breakdown.avgQuality).toBeCloseTo(0.5 + (0.95 - 0.5) * 0.5, 2)
  })

  it('failed tasks are unaffected — the discount only weights the quality of a SUCCESS', () => {
    const n = 10
    const selfFail = assessCredit(
      Array.from({ length: n }, (_, i) => ({ ...selfGraded(i, 0.9), eventType: 'TASK_FAILED', success: false })),
      undefined,
      NOW,
    )
    const verifiedFail = assessCredit(
      Array.from({ length: n }, (_, i) => ({ ...verified(i, 0.9), eventType: 'VERIFIED_TASK_FAILED', success: false })),
      undefined,
      NOW,
    )
    expect(selfFail.breakdown.performance).toBe(verifiedFail.breakdown.performance)
  })

  it('a cold-start agent with zero events is unaffected by any of this', () => {
    const result = assessCredit([], undefined, NOW)
    expect(result.score).toBe(300)
    expect(result.breakdown.avgQuality).toBe(0)
  })
})
