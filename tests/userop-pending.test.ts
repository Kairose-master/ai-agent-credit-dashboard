import { describe, it, expect } from 'vitest'
import { UserOpPendingError, isUserOpPending } from '@/lib/onchain/account'

// A receipt timeout is "not yet", not "no". Conflating the two is how a
// worker's finished job gets written down as failed while the chain says
// Submitted — two ledgers disagreeing, with a human needed to reconcile.

describe('UserOpPendingError', () => {
  const hash = '0x3c9aa7b0f7cdbc13f50b328d3b6e02953cae0f725a1196835093fd7c14deff01' as const

  it('carries the hash so the operation stays traceable', () => {
    expect(new UserOpPendingError(hash).userOpHash).toBe(hash)
  })

  it('says plainly that the operation may still land', () => {
    expect(new UserOpPendingError(hash).message).toMatch(/may still land/i)
  })

  it('is recognisable across a rethrow, unlike a message match', () => {
    const err: unknown = new UserOpPendingError(hash)
    expect(isUserOpPending(err)).toBe(true)
  })

  it('does not classify real failures as pending', () => {
    expect(isUserOpPending(new Error('execution reverted: USDC: balance'))).toBe(false)
    expect(isUserOpPending(null)).toBe(false)
    expect(isUserOpPending('timed out')).toBe(false)
  })
})
