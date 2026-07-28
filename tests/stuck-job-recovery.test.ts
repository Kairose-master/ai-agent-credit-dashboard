import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * V1's only way out of a frozen escrow.
 *
 * The V1 contract has no timeout of any kind — postJob, acceptJob, submitWork,
 * approveJob, raiseDispute, resolveDispute, cancelJob is its entire external
 * surface. So a job that no sweep will touch is frozen until a human calls
 * /api/admin/resolve-stuck-job, and that route is the remedy every version of
 * the dispute redesign kept naming.
 *
 * It 409'd on `Disputed`. The remedy did not exist.
 *
 * These are source assertions rather than behavioural ones because the route
 * signs real transactions against a live testnet — there is nothing here worth
 * mocking, and a mocked chain would assert the mock. What is worth pinning is
 * the shape: which states it accepts, and that it does not refuse to act for
 * the reasons that cause the freeze in the first place.
 */

const ROUTE = readFileSync('app/api/admin/resolve-stuck-job/route.ts', 'utf8')
const SWEEP = readFileSync('lib/labor-settle.ts', 'utf8')

/** Code only — a guard that fires on the comment explaining a rule is not
 *  checking the rule. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the admin remedy covers both states that hold escrow', () => {
  it('accepts Disputed, not only Submitted', () => {
    expect(code(ROUTE)).toMatch(/job\.status !== 'Submitted' && job\.status !== 'Disputed'/)
  })

  it('resolves a Disputed job directly, without raising a second dispute', () => {
    // It is already Disputed; raiseDispute would revert WrongStatus and take
    // the whole recovery with it.
    const body = code(ROUTE)
    const disputedBranch = body.slice(body.indexOf("if (job.status === 'Disputed')"))
    expect(disputedBranch).toMatch(/resolveDispute\(jobId, action === 'pay'\)/)
  })

  it('does NOT require a spec row to free a Disputed job', () => {
    // A missing spec row is one of the documented causes of the freeze, so
    // refusing to act without one declines to fix exactly the jobs that need
    // fixing. resolveDispute is arbiter-signed — the requester's agent is not
    // needed to make the call, only to write the note.
    const body = code(ROUTE)
    const disputedAt = body.indexOf("if (job.status === 'Disputed')")
    const requesterGuardAt = body.indexOf('no requester agent for this job')
    expect(disputedAt).toBeGreaterThan(-1)
    expect(requesterGuardAt).toBeGreaterThan(disputedAt)
  })
})

describe('the two bugs that cause the freeze to recur', () => {
  it('the route looks up the spec case-insensitively', () => {
    // A cleanup route that inherits the bug cannot clean up the jobs the bug
    // created.
    expect(code(ROUTE)).toMatch(/job\.specHash\.toLowerCase\(\)/)
  })

  it('the sweep looks up the spec case-insensitively too', () => {
    const sweep = code(SWEEP)
    const fn = sweep.slice(sweep.indexOf('export async function sweepDisputedJobs'))
    expect(fn).toMatch(/toLowerCase\(\)/)
    expect(fn).not.toMatch(/where\(eq\(jobSpec\.specHash, job\.specHash\)\)/)
  })

  it('both backfill onchainJobId — a null one strands the same job every pass', () => {
    const sweep = code(SWEEP)
    const fn = sweep.slice(sweep.indexOf('export async function sweepDisputedJobs'))
    expect(fn).toMatch(/onchainJobId/)
    expect(code(ROUTE)).toMatch(/onchainJobId/)
  })
})
