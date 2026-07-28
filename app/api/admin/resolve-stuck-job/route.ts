import { db } from '@/lib/db'
import { jobSpec } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'

/**
 * Admin cleanup for a job that cannot settle on its own.
 *
 *   POST /api/admin/resolve-stuck-job?job_id=N&action=refund|pay&secret=...
 *
 * Handles BOTH states that can strand escrow on V1:
 *
 *   Submitted — grader unavailable, hit the auto-repost cap, ungradable
 *               deliverable. Refund is dispute → resolve to requester.
 *   Disputed  — a dispute-refund-repost flow that died mid-flight, or one the
 *               automatic sweep is exempt from. Already disputed, so this
 *               resolves it directly.
 *
 * **Disputed used to 409 here**, and that mattered more than it looks: this
 * route is the remedy the whole dispute redesign kept naming for a job frozen
 * on live V1 — and the remedy did not exist. V1's contract has no timeout of
 * any kind (postJob, acceptJob, submitWork, approveJob, raiseDispute,
 * resolveDispute, cancelJob is its entire external surface), so a Disputed job
 * that no sweep will touch is frozen until a human calls exactly this.
 *
 * action defaults to 'refund'. Guarded by CRON_SECRET.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  const { requireOperator } = await import('@/lib/admin-route')
  const auth = requireOperator(request, { mutating: true })
  if (!auth.ok) return auth.response
  const url = new URL(request.url)

  const jobId = Number(url.searchParams.get('job_id'))
  const action = (url.searchParams.get('action') ?? 'refund').toLowerCase()
  if (!Number.isInteger(jobId)) return Response.json({ error: 'job_id required' }, { status: 400 })
  if (action !== 'refund' && action !== 'pay') return Response.json({ error: 'action must be refund or pay' }, { status: 400 })

  try {
    const { readJobs, raiseDispute, resolveDispute, approveJob } = await import('@/lib/onchain/labor')
    const jobs = await readJobs({ maxAgeMs: 0 })
    const job = jobs.find((j) => j.id === jobId)
    if (!job) return Response.json({ error: `job #${jobId} not found on-chain` }, { status: 404 })
    if (job.status !== 'Submitted' && job.status !== 'Disputed') {
      return Response.json(
        { error: `job #${jobId} is ${job.status} — only Submitted or Disputed hold escrow a human can free` },
        { status: 409 },
      )
    }

    // Case-insensitively, because the chain and keccak256 do not agree with the
    // database about hex case. The exact-match version of this lookup is why
    // sweepDisputedJobs skips some jobs forever, and a cleanup route that
    // inherits the same bug cannot clean up the jobs the bug created.
    const variants = [...new Set([job.specHash, job.specHash.toLowerCase()])]
    const [spec] = await db.select().from(jobSpec).where(inArray(jobSpec.specHash, variants))

    // Backfill the cancel/settle key while we are here — a null onchainJobId is
    // one of the reasons a job goes sweep-exempt in the first place.
    if (spec && spec.onchainJobId !== job.id) {
      await db.update(jobSpec).set({ onchainJobId: job.id }).where(eq(jobSpec.specHash, spec.specHash))
    }

    const note = (text: string) =>
      spec ? db.update(jobSpec).set({ disputeNote: text }).where(eq(jobSpec.specHash, spec.specHash)) : Promise.resolve()

    // Already Disputed: the arbiter can settle it outright, in EITHER direction.
    // Deliberately does not require a spec row. A missing spec row is one of the
    // documented causes of the freeze, so refusing to act without one would
    // decline to fix precisely the jobs that need fixing — and resolveDispute
    // is arbiter-signed, so the requester's agent is not needed to make the call.
    if (job.status === 'Disputed') {
      const txHash = await resolveDispute(jobId, action === 'pay')
      await note(
        action === 'pay'
          ? 'Admin: stuck dispute resolved — released to worker'
          : 'Admin: stuck dispute resolved — escrow refunded to requester',
      )
      return Response.json({
        status: 'ok',
        jobId,
        action,
        from: 'Disputed',
        title: spec?.title ?? null,
        bounty: job.bounty,
        txHash,
      })
    }

    // Submitted: both directions need the requester's agent to sign.
    if (!spec?.requesterAgentId) return Response.json({ error: 'no requester agent for this job' }, { status: 404 })

    if (action === 'pay') {
      const txHash = await approveJob(spec.requesterAgentId, jobId)
      await note('Admin: manually released to worker')
      return Response.json({ status: 'ok', jobId, action, from: 'Submitted', txHash })
    }

    await raiseDispute(spec.requesterAgentId, jobId)
    const txHash = await resolveDispute(jobId, false)
    await note('Admin: stuck job cleaned up — escrow refunded to requester')
    return Response.json({
      status: 'ok',
      jobId,
      action,
      from: 'Submitted',
      title: spec.title,
      bounty: job.bounty,
      txHash,
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
