/**
 * The rising-price tick: walk unclaimed jobs up toward their ceiling until
 * somebody takes one.
 *
 * ## Why a raise is a cancel-and-repost
 *
 * The LaborMarket contract escrows a job's bounty at postJob and pays that
 * exact amount at approveJob — there is no partial release and no top-up. So
 * a bounty cannot be edited in place: raising it means cancelling the old job
 * (which refunds the requester in full) and posting a fresh one at the higher
 * price. That is only safe while the job is still **Open**, because
 * cancelling a job somebody has already committed to would destroy their
 * work, so every raise re-checks live on-chain status first.
 *
 * This reuses the repost machinery the failed-grading path already relies on,
 * including `parentSpecHash`, so anything following the work — a delegation,
 * a watcher — follows it to the new job id.
 *
 * Best-effort and idempotent, like the other sweeps: safe to call from a hot
 * read path, and a crash mid-flight leaves either the old job or the new one
 * standing, never both.
 */
import { db } from '@/lib/db'
import { jobSpec } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { logPlatformEvent } from '@/lib/platform-feed'
import { nextPriceRaise } from '@/lib/market-price'
import { retry, retryRpc } from '@/lib/labor-settle'

const RAISE_SWEEP_COOLDOWN_MS = 60_000
let lastRaiseSweepAt = 0

/** Raise one Open job to `nextUsd`. Returns the new on-chain job id, or null
 *  if the raise did not happen (which is always a safe outcome). */
export async function raiseJobPrice(
  spec: typeof jobSpec.$inferSelect,
  nextUsd: number,
): Promise<number | null> {
  if (!spec.requesterAgentId || spec.onchainJobId === null || !spec.pricing) return null

  const { readJobs, cancelJob, postJob } = await import('@/lib/onchain/labor')
  const jobs = await retryRpc(() => readJobs({ maxAgeMs: 0 }))
  const job = jobs.find((j) => j.id === spec.onchainJobId)
  // Re-check under fresh state: a worker may have claimed it in the seconds
  // since the sweep decided. Cancelling then would throw away real work.
  if (!job || job.status !== 'Open') return null

  const { keccak256, toHex } = await import('viem')
  const newSpecHash = keccak256(
    toHex(JSON.stringify({ title: spec.title, agent: spec.requesterAgentId, price: nextUsd, nonce: nanoid() })),
  )

  // 1. Refund the old escrow. Irreversible once it lands, so the repost below
  //    is retried hard rather than allowed to fail.
  await retryRpc(() => cancelJob(spec.requesterAgentId!, spec.onchainJobId!))

  // 2. The same work, at the higher price, carrying the lineage forward.
  await db.insert(jobSpec).values({
    specHash: newSpecHash,
    title: spec.title,
    description: spec.description,
    acceptanceCriteria: spec.acceptanceCriteria,
    requesterAgentId: spec.requesterAgentId,
    attachmentUrl: spec.attachmentUrl,
    attachmentName: spec.attachmentName,
    testCode: spec.testCode,
    deliverableKind: spec.deliverableKind,
    requiredCapabilities: spec.requiredCapabilities,
    repoFullName: spec.repoFullName,
    baseBranch: spec.baseBranch,
    autoApprove: spec.autoApprove,
    failedWorkerIds: spec.failedWorkerIds,
    repostCount: spec.repostCount, // a price raise is not a failed attempt
    parentSpecHash: spec.specHash,
    pricing: { ...spec.pricing, raises: (spec.pricing.raises ?? 0) + 1 },
  })

  await retry(() => postJob(spec.requesterAgentId!, nextUsd, job.minScore, newSpecHash))

  let newJobId: number | null = null
  try {
    const fresh = await retryRpc(() => readJobs({ maxAgeMs: 0 }))
    const posted = fresh.find((j) => j.specHash.toLowerCase() === newSpecHash.toLowerCase())
    if (posted) {
      newJobId = posted.id
      await db.update(jobSpec).set({ onchainJobId: posted.id }).where(eq(jobSpec.specHash, newSpecHash))
    }
  } catch (e) {
    console.error('[price-raise] onchainJobId backfill failed (non-fatal):', e)
  }

  await logPlatformEvent(
    'JOB_PRICE_RAISED',
    `"${spec.title}" went unclaimed — bounty raised to $${nextUsd}${newJobId ? ` (now job #${newJobId})` : ''}`,
  )
  return newJobId
}

/**
 * Sweep every Open job carrying a rising-price plan and raise the ones that
 * have waited long enough. Throttled; failures are logged, never thrown.
 */
export async function sweepPriceRaises(): Promise<number> {
  const now = Date.now()
  if (now - lastRaiseSweepAt < RAISE_SWEEP_COOLDOWN_MS) return 0
  lastRaiseSweepAt = now

  let raised = 0
  try {
    const { isLaborMarketConfigured } = await import('@/lib/onchain/config')
    if (!isLaborMarketConfigured()) return 0

    const specs = (await db.select().from(jobSpec)).filter((s) => s.pricing && s.onchainJobId !== null)
    if (specs.length === 0) return 0

    const { readJobs } = await import('@/lib/onchain/labor')
    const jobs = await readJobs().catch(() => [])
    const openById = new Map(jobs.filter((j) => j.status === 'Open').map((j) => [j.id, j]))

    for (const spec of specs) {
      const job = openById.get(spec.onchainJobId!)
      if (!job) continue // claimed, completed or cancelled — nothing to raise
      const ageMinutes = (now - new Date(spec.createdAt).getTime()) / 60_000
      const decision = nextPriceRaise({ currentUsd: job.bounty, ageMinutes, plan: spec.pricing })
      if (!decision.shouldRaise) continue
      try {
        console.log(`[price-raise] job #${spec.onchainJobId}: ${decision.reason}`)
        if (await raiseJobPrice(spec, decision.nextUsd)) raised++
      } catch (error) {
        console.error(`[price-raise] raise of job #${spec.onchainJobId} failed:`, error)
      }
    }
  } catch (error) {
    console.error('[price-raise] sweep failed:', error)
  }
  return raised
}
