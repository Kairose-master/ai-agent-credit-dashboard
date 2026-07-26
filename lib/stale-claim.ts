/**
 * Abandoned-claim recovery — the way money gets un-stuck.
 *
 * The LaborMarket contract has no exit from `Accepted`: `cancelJob` requires
 * Open and `raiseDispute` requires Submitted, so a worker that claims a job
 * and never delivers freezes the requester's escrow FOREVER. That is the
 * worst failure a market can have — worse than a bad deliverable, because
 * the buyer loses the money and the work — and it is also a griefing attack:
 * claim every open job, deliver nothing, and the whole market's liquidity
 * stops. Nothing on-chain times out.
 *
 * The escape uses authority the platform already holds. Every agent's
 * smart account is operated by the platform (sendAgentCall), so for an
 * abandoned claim it can walk the state machine the contract does allow:
 *
 *   submitWork(worker, ABANDONED_RESULT)  Accepted  → Submitted
 *   raiseDispute(requester)               Submitted → Disputed
 *   resolveDispute(jobId, false)          Disputed  → Refunded ✔ money back
 *
 * Each step re-reads the live status first, so a pass that dies halfway
 * resumes on the next run instead of double-spending a transition. The
 * worker takes a real graded failure for it: abandonment has to cost
 * reputation, or claiming everything and delivering nothing stays free.
 *
 * Deliberately NOT a contract migration. A `reclaimJob(jobId)` with an
 * on-chain deadline is the right long-term shape, but it needs a redeploy
 * and a migration of every live job; this recovers the funds already stuck
 * today with the contract as deployed.
 */
import { db } from '@/lib/db'
import { agent, agentEvent, agentTask, jobSpec } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

/** How long a claim may sit without delivery before it is abandoned. */
export function claimDeadlineMs(): number {
  const hours = Number(process.env.CLAIM_DEADLINE_HOURS)
  const h = Number.isFinite(hours) && hours > 0 ? hours : 6
  return h * 60 * 60 * 1000
}

/** At most this many jobs recovered per pass — each costs three UserOps. */
const MAX_PER_PASS = 3

/**
 * Is this claim abandoned? Pure, so the policy is testable without a chain.
 *
 * `lastActivityAt` is the worker's most recent sign of life (a long-running
 * job's progress heartbeat touches its task row): a job that is genuinely
 * still being worked must never be reclaimed out from under it. An unknown
 * claim time is treated as NOT abandoned — never destroy a position on
 * missing evidence.
 */
export function isClaimAbandoned(
  now: Date,
  claimedAt: Date | null,
  lastActivityAt: Date | null,
  deadlineMs: number = claimDeadlineMs(),
): boolean {
  if (!claimedAt && !lastActivityAt) return false
  const last = Math.max(claimedAt?.getTime() ?? 0, lastActivityAt?.getTime() ?? 0)
  if (last === 0) return false
  return now.getTime() - last > deadlineMs
}

/** Marker result hash recorded on-chain for a reclaimed job, so the chain
 *  itself distinguishes "abandoned, refunded" from a real submission.
 *  keccak of a fixed sentence — a hand-written hex literal is one typo away
 *  from being invalid bytes32, and this one only ever meets a real chain. */
export async function abandonedResultHash(): Promise<`0x${string}`> {
  const { keccak256, toHex } = await import('viem')
  return keccak256(toHex('ledgermind:claim-abandoned'))
}

export type ReclaimReport = { reclaimed: number; examined: number; skipped?: string }

export async function reclaimAbandonedJobs(now = new Date()): Promise<ReclaimReport> {
  const { isLaborMarketConfigured } = await import('@/lib/onchain/config')
  if (!isLaborMarketConfigured()) return { reclaimed: 0, examined: 0, skipped: 'labor market not configured' }

  const { readJobs, submitWork, raiseDispute, resolveDispute } = await import('@/lib/onchain/labor')
  const jobs = await readJobs({ maxAgeMs: 0 }).catch(() => [])
  const accepted = jobs.filter((j) => j.status === 'Accepted')
  if (accepted.length === 0) return { reclaimed: 0, examined: 0 }

  let reclaimed = 0
  let examined = 0

  for (const job of accepted) {
    if (reclaimed >= MAX_PER_PASS) break
    examined++
    try {
      const [spec] = await db.select().from(jobSpec).where(eq(jobSpec.specHash, job.specHash))
      if (!spec?.requesterAgentId) continue

      // Last sign of life: the claim itself, or the worker's task row if a
      // long-running job has been reporting progress.
      let lastActivityAt: Date | null = null
      if (spec.agentTaskId) {
        const [task] = await db.select({ updatedAt: agentTask.updatedAt }).from(agentTask).where(eq(agentTask.id, spec.agentTaskId))
        lastActivityAt = task?.updatedAt ?? null
      }
      if (!isClaimAbandoned(now, spec.claimedAt, lastActivityAt)) continue

      // Addresses on the chain are the authority for BOTH sides: the
      // off-chain claim lock may already have been TTL'd away, and
      // `raiseDispute` reverts with NotRequester unless the caller is
      // literally job.requester (which differs from spec.requesterAgentId
      // for house-fronted x402 postings).
      const [workerAgent] = await db
        .select({ id: agent.id, name: agent.name, userId: agent.userId })
        .from(agent)
        .where(eq(agent.smartAccountAddress, job.worker))
      if (!workerAgent) continue

      const [requesterAgent] = await db
        .select({ id: agent.id })
        .from(agent)
        .where(eq(agent.smartAccountAddress, job.requester))
      if (!requesterAgent) continue

      // Walk the state machine, re-reading status before each transition so a
      // half-finished previous pass resumes rather than repeating a step.
      let status = job.status as string
      if (status === 'Accepted') {
        await submitWork(workerAgent.id, job.id, await abandonedResultHash())
        status = 'Submitted'
      }
      if (status === 'Submitted') {
        await raiseDispute(requesterAgent.id, job.id)
        status = 'Disputed'
      }
      if (status === 'Disputed') {
        await resolveDispute(job.id, false) // refund the requester
        status = 'Refunded'
      }

      // Abandonment is a real, platform-verified failure to deliver — not a
      // self-report — so it lands as a graded negative on the worker's
      // record. Idempotent per job.
      const eventTaskId = `abandoned-${job.id}`
      const existing = await db.select({ id: agentEvent.id }).from(agentEvent).where(eq(agentEvent.taskId, eventTaskId))
      if (existing.length === 0) {
        await db.insert(agentEvent).values({
          id: nanoid(),
          agentId: workerAgent.id,
          taskId: eventTaskId,
          eventType: 'VERIFIED_TASK_FAILED',
          success: false,
          executionTime: 0,
          tokenCost: 0,
          qualityScore: '0.000',
          detail: {
            jobId: job.id,
            reason: 'claim abandoned — no delivery before the deadline',
            bounty: job.bounty,
            requesterAgentId: spec.requesterAgentId,
          },
        })
        const { recalculateCredit } = await import('@/lib/credit-engine')
        await recalculateCredit(workerAgent.id).catch(() => {})
      }

      const { logPlatformEvent } = await import('@/lib/platform-feed')
      await logPlatformEvent(
        'CLAIM_ABANDONED',
        `Job #${job.id} was claimed but never delivered — $${job.bounty} refunded to the requester and the claim recorded as a failed delivery`,
      ).catch(() => {})

      // A refund the requester never hears about is barely better than the
      // freeze: for a bounty that came from a GitHub issue, say so where it
      // was posted, and name the one gesture that retries it.
      if (spec.repoFullName && spec.issueNumber) {
        try {
          const { commentOnPr } = await import('@/lib/github-app')
          await commentOnPr(
            spec.repoFullName,
            spec.issueNumber,
            `↩️ The worker that claimed this bounty never delivered, so the escrow was released back to you — **$${job.bounty} refunded**, nothing was charged for the abandoned attempt.\n\n` +
              `Re-add the \`bounty:$${job.bounty}\` label to put it back on the market for a different worker.`,
          )
        } catch (error) {
          console.error(`[stale-claim] issue comment for job ${job.id} failed (non-fatal):`, error)
        }
      }

      reclaimed++
    } catch (error) {
      console.error(`[stale-claim] reclaiming job ${job.id} failed:`, error)
    }
  }

  return { reclaimed, examined }
}
