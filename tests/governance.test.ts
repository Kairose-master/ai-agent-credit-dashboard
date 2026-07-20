import { describe, expect, it } from 'vitest'
import { lockVotingPower, totalVotingPower, tallyVotes, MAX_LOCK_WEEKS, WEEK_MS, QUORUM_POWER } from '@/lib/governance'

const now = 1_000_000_000

describe('lockVotingPower (ve decay)', () => {
  it('a full-length lock starts near its amount and decays to zero', () => {
    const full = { amount: 100, unlockAt: now + MAX_LOCK_WEEKS * WEEK_MS }
    expect(lockVotingPower(full, now)).toBeCloseTo(100, 5) // ~amount at t=0
    // Halfway through a max lock → ~half power.
    const half = { amount: 100, unlockAt: now + (MAX_LOCK_WEEKS / 2) * WEEK_MS }
    expect(lockVotingPower(half, now)).toBeCloseTo(50, 5)
  })

  it('a shorter lock gives proportionally less power per token', () => {
    const oneYear = { amount: 100, unlockAt: now + 52 * WEEK_MS }
    const halfYear = { amount: 100, unlockAt: now + 26 * WEEK_MS }
    expect(lockVotingPower(halfYear, now)).toBeCloseTo(lockVotingPower(oneYear, now) / 2, 5)
  })

  it('is zero at/after unlock', () => {
    expect(lockVotingPower({ amount: 100, unlockAt: now }, now)).toBe(0)
    expect(lockVotingPower({ amount: 100, unlockAt: now - 1 }, now)).toBe(0)
  })

  it('never exceeds the locked amount', () => {
    const overlong = { amount: 100, unlockAt: now + 2 * MAX_LOCK_WEEKS * WEEK_MS }
    expect(lockVotingPower(overlong, now)).toBeLessThanOrEqual(100)
  })

  it('sums across locks', () => {
    const power = totalVotingPower(
      [
        { amount: 100, unlockAt: now + MAX_LOCK_WEEKS * WEEK_MS },
        { amount: 100, unlockAt: now + (MAX_LOCK_WEEKS / 2) * WEEK_MS },
      ],
      now,
    )
    expect(power).toBeCloseTo(150, 4)
  })
})

describe('tallyVotes', () => {
  it('passes only with quorum AND for > against', () => {
    const r = tallyVotes([
      { choice: 'for', power: 40 },
      { choice: 'against', power: 20 },
    ])
    expect(r.total).toBe(60)
    expect(r.quorumMet).toBe(true) // >= QUORUM_POWER (50)
    expect(r.passed).toBe(true)
  })

  it('fails below quorum even if unanimously for', () => {
    const r = tallyVotes([{ choice: 'for', power: QUORUM_POWER - 1 }])
    expect(r.quorumMet).toBe(false)
    expect(r.passed).toBe(false)
  })

  it('fails on a tie (for must strictly outweigh against)', () => {
    const r = tallyVotes([
      { choice: 'for', power: 30 },
      { choice: 'against', power: 30 },
    ])
    expect(r.quorumMet).toBe(true)
    expect(r.passed).toBe(false)
  })

  it('abstain counts toward quorum but not the for/against decision', () => {
    const r = tallyVotes([
      { choice: 'for', power: 20 },
      { choice: 'against', power: 10 },
      { choice: 'abstain', power: 25 },
    ])
    expect(r.total).toBe(55)
    expect(r.quorumMet).toBe(true)
    expect(r.passed).toBe(true) // 20 > 10
  })
})
