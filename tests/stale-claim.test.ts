import { describe, it, expect } from 'vitest'
import { isClaimAbandoned, claimDeadlineMs } from '@/lib/stale-claim'

const HOUR = 60 * 60 * 1000
const now = new Date('2026-07-26T12:00:00Z')
const ago = (h: number) => new Date(now.getTime() - h * HOUR)

// The contract has no exit from Accepted, so this predicate is the only
// thing standing between a vanished worker and permanently frozen escrow —
// and equally, the only thing that could steal a job from someone who is
// still working it.

describe('isClaimAbandoned', () => {
  const deadline = 6 * HOUR

  it('leaves a fresh claim alone', () => {
    expect(isClaimAbandoned(now, ago(1), null, deadline)).toBe(false)
  })

  it('reclaims a claim older than the deadline with no activity', () => {
    expect(isClaimAbandoned(now, ago(7), null, deadline)).toBe(true)
  })

  it('never reclaims a long-running job that is still reporting progress', () => {
    // Claimed two days ago, but the worker's task row was touched a minute
    // ago — reclaiming this would destroy work in flight.
    expect(isClaimAbandoned(now, ago(48), new Date(now.getTime() - 60_000), deadline)).toBe(false)
  })

  it('reclaims when the progress heartbeat itself went silent', () => {
    expect(isClaimAbandoned(now, ago(48), ago(9), deadline)).toBe(true)
  })

  it('treats unknown timing as NOT abandoned — never act on missing evidence', () => {
    expect(isClaimAbandoned(now, null, null, deadline)).toBe(false)
  })

  it('is exactly at the boundary, not before it', () => {
    expect(isClaimAbandoned(now, new Date(now.getTime() - deadline), null, deadline)).toBe(false)
    expect(isClaimAbandoned(now, new Date(now.getTime() - deadline - 1), null, deadline)).toBe(true)
  })
})

describe('claimDeadlineMs', () => {
  it('defaults to six hours and rejects nonsense overrides', () => {
    const original = process.env.CLAIM_DEADLINE_HOURS
    delete process.env.CLAIM_DEADLINE_HOURS
    expect(claimDeadlineMs()).toBe(6 * HOUR)
    process.env.CLAIM_DEADLINE_HOURS = 'soon'
    expect(claimDeadlineMs()).toBe(6 * HOUR)
    process.env.CLAIM_DEADLINE_HOURS = '-3'
    expect(claimDeadlineMs()).toBe(6 * HOUR)
    process.env.CLAIM_DEADLINE_HOURS = '2'
    expect(claimDeadlineMs()).toBe(2 * HOUR)
    if (original === undefined) delete process.env.CLAIM_DEADLINE_HOURS
    else process.env.CLAIM_DEADLINE_HOURS = original
  })
})
