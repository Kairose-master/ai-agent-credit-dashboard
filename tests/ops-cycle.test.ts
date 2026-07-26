import { describe, it, expect } from 'vitest'
import { OPS_STEPS, TRAFFIC_TICK_INTERVAL_MS } from '@/lib/ops-cycle'

// The cron and ordinary traffic run the SAME step list; these pin the
// properties that keep the two entry points honest.

describe('OPS_STEPS', () => {
  it('has unique step names — the report is keyed by them', () => {
    const names = OPS_STEPS.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('marks the visitor-facing sweeps fast, and the expensive ones not', () => {
    const fast = OPS_STEPS.filter((s) => s.fast).map((s) => s.name)
    // Money that should have moved, escrow that should have been freed, and
    // an empty board are what a visitor can actually feel.
    expect(fast).toContain('sweep')
    expect(fast).toContain('abandonedClaims')
    expect(fast).toContain('boardRestock')
    // LLM-backed and fan-out work stays on the cron's guaranteed budget.
    expect(fast).not.toContain('autoVotes')
    expect(fast).not.toContain('delegations')
    expect(fast).not.toContain('faucet')
  })

  it('keeps the fast subset small enough to finish inside a request budget', () => {
    expect(OPS_STEPS.filter((s) => s.fast).length).toBeLessThanOrEqual(8)
  })

  it('ticks traffic no more than once every five minutes', () => {
    expect(TRAFFIC_TICK_INTERVAL_MS).toBeGreaterThanOrEqual(5 * 60_000)
  })
})
