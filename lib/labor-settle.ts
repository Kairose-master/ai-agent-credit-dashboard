/**
 * Post-grading settlement for Labor Market jobs — extracted from
 * /api/runtime/callback so it can run from TWO places:
 *
 *   1. The submission callback (the moment grading finishes) — the fast
 *      path, exactly as before.
 *   2. sweepStuckGradedJobs() — the recovery path. Settlement used to be
 *      one-shot: a transient RPC failure (Alchemy free-tier 429s under
 *      polling load, observed live) at the approve/refund step left a
 *      PASSED job sitting in Submitted forever, showing manual
 *      approve/dispute buttons for work the grader had already judged.
 *      The sweep re-drives the correct path for any Submitted job whose
 *      spec already carries a grading verdict, from the same opportunistic
 *      read-path ticks the platform already uses (no cron).
 *
 * Both paths are safe to re-run: every branch re-checks the live on-chain
 * job status ('Submitted') before moving funds, so a retry after a partial
 * failure resumes rather than double-pays.
 */
import { db } from '@/lib/db'
import { agentEvent, jobSpec } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { logPlatformEvent } from '@/lib/platform-feed'

/** Retries a step that runs AFTER a prior on-chain action already
 *  succeeded and can't be undone — a transient DB/RPC failure here would
 *  otherwise permanently strand bookkeeping for money that already moved. */
export async function retry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 500): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)))
    }
  }
  throw lastError
}

function isTransientRpcError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return msg.includes('429') || /rate limit|Too Many Requests|compute units/i.test(msg)
}

/** Retry wrapper specifically for on-chain calls that may hit RPC rate
 *  limits — longer backoff than `retry` (a 429 needs breathing room, not
 *  a 500ms hammer), and only retries the transient class. */
async function retryRpc<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!isTransientRpcError(error) || i === attempts - 1) throw error
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)))
    }
  }
  throw lastError
}

// Bounds how much a single compromised/over-lenient grader verdict can
// release with zero requester involvement. Above this, a passing job still
// waits for the requester's own "Approve & pay" — auto-approve exists to
// stop small/unwatched jobs (seed jobs, idle requesters) from stranding a
// worker unpaid, not to hand a grader unlimited fund-release authority.
export const AUTO_APPROVE_MAX_BOUNTY_USD = Number(process.env.AUTO_APPROVE_MAX_BOUNTY_USD ?? 50)

/**
 * Acceptance tests passed — an independently graded, objective fact, the
 * same authority the failure path (returnFailedJobToMarket) already acts on
 * automatically. Release the escrow instead of leaving the job "Submitted"
 * waiting on a human "Approve & pay" click that may never come.
 *
 * The actual authorization for this is `spec.autoApprove` — the requester's
 * own explicit choice, recorded on an authenticated call to postJobAction
 * at the time THEY posted the job. AUTO_APPROVE_MAX_BOUNTY_USD is the
 * second, independent layer bounding what a single grader mistake can move.
 */
export async function autoApprovePassedJob(spec: typeof jobSpec.$inferSelect): Promise<void> {
  if (!spec.requesterAgentId || !spec.workerAgentId || spec.onchainJobId === null) return
  if (!spec.autoApprove) return // requester opted out — stays Submitted for their own review

  let approvedTxHash: string | null = null
  try {
    const { readJobs, approveJob } = await import('@/lib/onchain/labor')
    const jobs = await retryRpc(() => readJobs())
    const job = jobs.find((j) => j.id === spec.onchainJobId)
    if (!job || job.status !== 'Submitted') return

    if (Number.isFinite(AUTO_APPROVE_MAX_BOUNTY_USD) && job.bounty > AUTO_APPROVE_MAX_BOUNTY_USD) {
      console.log(
        `[labor-settle] job ${spec.onchainJobId} passed tests but bounty $${job.bounty} exceeds the $${AUTO_APPROVE_MAX_BOUNTY_USD} auto-approve cap — left Submitted for the requester to approve manually`,
      )
      return
    }

    approvedTxHash = await retryRpc(() => approveJob(spec.requesterAgentId!, spec.onchainJobId!))

    // approveJob just moved real funds on-chain and flipped the job to
    // Completed — from here there's no path back to "Submitted", so a
    // transient failure recording the credit event would otherwise strand
    // it forever. Retry the DB-only half before giving up.
    const { creditWorkerForJob } = await import('@/app/actions/labor')
    await retry(() => creditWorkerForJob(job.worker, spec.onchainJobId!, job.bounty, approvedTxHash!))

    await logPlatformEvent(
      'JOB_AUTO_APPROVED',
      `"${spec.title}" — acceptance tests passed (independent grader), escrow released automatically`,
    )
  } catch (error) {
    console.error('[labor-settle] auto-approve failed:', error)
    if (approvedTxHash) {
      // Escrow already released on-chain — the worker was paid — but
      // recording that fact failed even after retries. Surface it so an
      // admin can backfill the credit event by hand.
      await logPlatformEvent(
        'JOB_AUTO_APPROVE_INCOMPLETE',
        `"${spec.title}" — escrow released (tx ${approvedTxHash.slice(0, 10)}…) but credit recording failed after retries — job #${spec.onchainJobId} needs a manual credit backfill`,
      ).catch(() => {})
    }
  }
}

export const MAX_AUTO_REPOSTS = 2

/**
 * Failed acceptance tests are an objective verdict — return the job to the
 * market automatically: dispute → arbiter refunds the requester → repost
 * the same spec as a fresh job for a DIFFERENT worker (failed workers are
 * blocked off-chain; parent_spec_hash records the lineage so anything
 * tracking the original — a delegation — follows the replacement). Capped
 * at MAX_AUTO_REPOSTS per lineage so a broken test suite can't burn escrow
 * round-trips forever.
 */
export async function returnFailedJobToMarket(spec: typeof jobSpec.$inferSelect): Promise<void> {
  if (!spec.requesterAgentId || !spec.workerAgentId || spec.onchainJobId === null) return
  if (spec.repostCount >= MAX_AUTO_REPOSTS) {
    console.warn(`[labor-settle] job ${spec.onchainJobId} failed tests but hit the auto-repost cap — leaving for manual review`)
    return
  }

  let refunded = false
  try {
    const { readJobs, raiseDispute, resolveDispute, postJob } = await import('@/lib/onchain/labor')
    const jobs = await retryRpc(() => readJobs())
    const job = jobs.find((j) => j.id === spec.onchainJobId)
    if (!job || job.status !== 'Submitted') return

    // 1. Requester's agent disputes; the arbiter refunds — both platform-
    //    signed, justified by the objective test verdict.
    await retryRpc(() => raiseDispute(spec.requesterAgentId!, spec.onchainJobId!))
    await db
      .update(jobSpec)
      .set({ disputeNote: 'Auto: acceptance tests failed (independent grader) — refunded and reposted' })
      .where(eq(jobSpec.specHash, spec.specHash))
    await retryRpc(() => resolveDispute(spec.onchainJobId!, false))
    refunded = true // irreversible from here — resolveDispute already paid out

    // 2. Repost the same spec as a fresh on-chain job, blocking every worker
    //    that already failed this lineage.
    const { keccak256, toHex } = await import('viem')
    const newSpecHash = keccak256(
      toHex(JSON.stringify({ title: spec.title, agent: spec.requesterAgentId, nonce: nanoid() })),
    )
    const failedWorkers = [...new Set([...(spec.failedWorkerIds ?? []), spec.workerAgentId])]
    await db.insert(jobSpec).values({
      specHash: newSpecHash,
      title: spec.title,
      description: spec.description,
      acceptanceCriteria: spec.acceptanceCriteria,
      requesterAgentId: spec.requesterAgentId,
      attachmentUrl: spec.attachmentUrl,
      attachmentName: spec.attachmentName,
      testCode: spec.testCode,
      repostCount: spec.repostCount + 1,
      failedWorkerIds: failedWorkers,
      autoApprove: spec.autoApprove, // carry the requester's original consent choice forward, don't silently reset it
      parentSpecHash: spec.specHash, // explicit lineage — lets delegations follow the work to its replacement
    })
    const txHash = await retry(() => postJob(spec.requesterAgentId!, job.bounty, job.minScore, newSpecHash))

    await logPlatformEvent(
      'JOB_AUTO_REPOSTED',
      `"${spec.title}" — tests failed, escrow auto-refunded, reposted for a different worker (attempt ${spec.repostCount + 2})`,
    )
    console.log(`[labor-settle] job ${spec.onchainJobId} auto-returned to market (repost tx ${txHash})`)
  } catch (error) {
    console.error('[labor-settle] auto-return to market failed:', error)
    if (refunded) {
      // The refund already completed on-chain and is irreversible, but the
      // replacement job failed to post even after retries — surfaced so an
      // admin can manually repost the spec.
      await logPlatformEvent(
        'JOB_REPOST_FAILED',
        `"${spec.title}" — refund completed but repost failed after retries — job #${spec.onchainJobId} needs a manual repost`,
      ).catch(() => {})
    }
  }
}

const STUCK_SWEEP_COOLDOWN_MS = 20_000
let lastStuckSweepAt = 0

/**
 * Recovery sweep: any Submitted job whose spec already holds a grading
 * verdict is settlement that started and died mid-flight (the callback's
 * attempt hit a transient failure). Re-drive the correct path. Throttled,
 * best-effort, and safe to call from any hot read path — both settle
 * functions re-check live on-chain status before moving anything.
 */
export async function sweepStuckGradedJobs(): Promise<void> {
  const now = Date.now()
  if (now - lastStuckSweepAt < STUCK_SWEEP_COOLDOWN_MS) return
  lastStuckSweepAt = now

  try {
    const { isLaborMarketConfigured } = await import('@/lib/onchain/config')
    if (!isLaborMarketConfigured()) return

    const specs = await db.select().from(jobSpec)
    const graded = specs.filter((s) => s.testResult && s.testResult.passed !== null && s.onchainJobId !== null)
    if (graded.length === 0) return

    const { readJobs } = await import('@/lib/onchain/labor')
    const jobs = await readJobs()

    for (const spec of graded) {
      const job = jobs.find((j) => j.id === spec.onchainJobId)
      if (!job || job.status !== 'Submitted') continue
      console.log(`[labor-settle] re-driving stuck settlement for job #${spec.onchainJobId} (passed=${spec.testResult!.passed})`)
      if (spec.testResult!.passed) {
        await autoApprovePassedJob(spec)
      } else {
        await returnFailedJobToMarket(spec)
      }
    }
  } catch (error) {
    console.error('[labor-settle] stuck sweep failed:', error)
  }
}
