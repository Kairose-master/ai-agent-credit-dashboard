/**
 * Collusion-resistant scoring. The attack these weights exist for: two
 * accounts trading easy LLM-graded jobs back and forth to farm each other's
 * credit scores ("wash trading"). Neither of the papers that motivated this
 * (Agent Bazaar's Sybil lemon market, Diagon's reputation exploits) tested
 * it — it is the obvious attack on THIS platform, so it gets pinned here.
 */
import { describe, expect, it } from 'vitest'
import {
  assessCredit,
  collusionWeight,
  graderWeight,
  weightedMarketSignal,
  type AgentEventInput,
} from '@/lib/credit-engine/scoring'

const base = (over: Partial<AgentEventInput>): AgentEventInput => ({
  eventType: 'JOB_TESTS_PASSED',
  success: true,
  executionTime: 1,
  tokenCost: 0,
  qualityScore: 1,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  ...over,
})

const at = (i: number) => new Date(Date.UTC(2026, 6, 1, i)) // strictly increasing hours

describe('collusionWeight', () => {
  it('gives the first trade with a counterparty full weight, then decays 1/√k', () => {
    expect(collusionWeight(0)).toBe(1)
    expect(collusionWeight(1)).toBeCloseTo(1 / Math.SQRT2, 10)
    expect(collusionWeight(8)).toBeCloseTo(1 / 3, 10)
  })
})

describe('graderWeight', () => {
  it("ranks graders by how hard a colluding pair can game them, buyer's CI on top", () => {
    expect(graderWeight('repo-ci')).toBeGreaterThan(graderWeight('tests'))
    expect(graderWeight('tests')).toBeGreaterThan(graderWeight('vision'))
    expect(graderWeight('vision')).toBeGreaterThan(graderWeight('llm-review'))
  })
  it('gives unknown/legacy graders the middle weight, never the top', () => {
    expect(graderWeight(null)).toBeLessThan(graderWeight('repo-ci'))
    expect(graderWeight(undefined)).toBe(graderWeight('some-future-grader'))
  })
})

describe('weightedMarketSignal — the wash-trading scenario', () => {
  it('ten LLM-graded jobs from ONE partner are worth far less than ten from ten strangers', () => {
    const ring = Array.from({ length: 10 }, (_, i) =>
      base({ counterparty: 'accomplice', grader: 'llm-review', createdAt: at(i) }),
    )
    const diverse = Array.from({ length: 10 }, (_, i) =>
      base({ counterparty: `stranger-${i}`, grader: 'llm-review', createdAt: at(i) }),
    )
    const ringScore = weightedMarketSignal(ring, 'JOB_TESTS_PASSED')
    const diverseScore = weightedMarketSignal(diverse, 'JOB_TESTS_PASSED')
    expect(diverseScore).toBeCloseTo(10 * 0.6, 5)
    // Σ 1/√k for k=1..10 ≈ 5.021 → ×0.6 ≈ 3.013: the ring earns ~half, and
    // each additional wash trade adds only ~1/√k of a real one.
    expect(ringScore).toBeCloseTo(3.013, 2)
    expect(ringScore).toBeLessThan(diverseScore * 0.55)
  })

  it('CI-graded work outweighs LLM-graded work at equal volume', () => {
    const ci = Array.from({ length: 5 }, (_, i) =>
      base({ counterparty: `r${i}`, grader: 'repo-ci', createdAt: at(i) }),
    )
    const llm = Array.from({ length: 5 }, (_, i) =>
      base({ counterparty: `r${i}`, grader: 'llm-review', createdAt: at(i) }),
    )
    expect(weightedMarketSignal(ci, 'JOB_TESTS_PASSED')).toBeGreaterThan(
      2 * weightedMarketSignal(llm, 'JOB_TESTS_PASSED'),
    )
  })

  it('legacy events (no counterparty, no grader) keep a sane weight — no retroactive penalty', () => {
    const legacy = Array.from({ length: 4 }, (_, i) => base({ createdAt: at(i) }))
    expect(weightedMarketSignal(legacy, 'JOB_TESTS_PASSED')).toBeCloseTo(4 * 0.8, 5)
  })

  it('orders chronologically: early trades with a partner keep more weight than later ones', () => {
    // Same events, shuffled input — the weighting must not depend on array order.
    const events = [
      base({ counterparty: 'x', grader: 'code', createdAt: at(2) }),
      base({ counterparty: 'x', grader: 'code', createdAt: at(0) }),
      base({ counterparty: 'x', grader: 'code', createdAt: at(1) }),
    ]
    const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    expect(weightedMarketSignal(events, 'JOB_TESTS_PASSED')).toBeCloseTo(
      weightedMarketSignal(sorted, 'JOB_TESTS_PASSED'),
      10,
    )
  })
})

describe('assessCredit end-to-end: the ring farms less score than honest diversity', () => {
  const terminal = (i: number): AgentEventInput =>
    base({ eventType: 'TASK_COMPLETED', qualityScore: 0.9, createdAt: at(i) })

  const withMarket = (marketEvents: AgentEventInput[]) =>
    assessCredit([...Array.from({ length: 10 }, (_, i) => terminal(i)), ...marketEvents])

  it('same volume, same graders — diverse counterparties strictly outscore the ring', () => {
    const ring = withMarket(
      Array.from({ length: 12 }, (_, i) =>
        base({ eventType: 'JOB_COMPLETED', counterparty: 'accomplice', grader: 'llm-review', createdAt: at(20 + i) }),
      ),
    )
    const diverse = withMarket(
      Array.from({ length: 12 }, (_, i) =>
        base({ eventType: 'JOB_COMPLETED', counterparty: `client-${i}`, grader: 'llm-review', createdAt: at(20 + i) }),
      ),
    )
    expect(diverse.score).toBeGreaterThan(ring.score)
  })

  it('a defaulted loan still craters the score (the spine the sweep now makes reachable)', () => {
    const clean = withMarket([])
    const defaulted = assessCredit([
      ...Array.from({ length: 10 }, (_, i) => terminal(i)),
      base({ eventType: 'REPAYMENT_DEFAULTED', success: false, qualityScore: null, createdAt: at(30) }),
    ])
    expect(defaulted.score).toBeLessThan(clean.score)
  })
})
