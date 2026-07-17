'use server'

/**
 * Worker Console ("mining layer") data: what a GPU owner cares about —
 * is my worker online, what has it earned, how often does independent
 * grading pass its work, and how much work is waiting on the market.
 * Every number is a live query over the same tables that drive credit
 * scoring; earnings come from JOB_COMPLETED events' recorded bounties.
 */
import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent, agentEvent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function getWorkerConsole() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')

  const agents = await db.select().from(agent).where(eq(agent.userId, session.user.id))

  const workers = await Promise.all(
    agents.map(async (a) => {
      const events = await db.select().from(agentEvent).where(eq(agentEvent.agentId, a.id))
      const count = (type: string) => events.filter((e) => e.eventType === type).length

      // Current streak: consecutive independent-grader passes, newest first,
      // broken by the first graded failure.
      const GRADED_PASS = new Set(['JOB_TESTS_PASSED', 'VERIFIED_TASK_COMPLETED'])
      const GRADED_ALL = new Set([...GRADED_PASS, 'JOB_TESTS_FAILED', 'VERIFIED_TASK_FAILED'])
      const graded = events
        .filter((e) => GRADED_ALL.has(e.eventType))
        .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
      let streak = 0
      for (const e of graded) {
        if (GRADED_PASS.has(e.eventType)) streak += 1
        else break
      }
      const earnedUsd = events
        .filter((e) => e.eventType === 'JOB_COMPLETED')
        .reduce((sum, e) => {
          const bounty = (e.detail as { bounty?: number } | null)?.bounty
          return sum + (typeof bounty === 'number' ? bounty : 0)
        }, 0)

      return {
        id: a.id,
        name: a.name,
        runtime: (a.runtimeType ?? 'platform') as 'platform' | 'webhook' | 'local' | 'cloud',
        autoMine: a.autoMine,
        provisioned: Boolean(a.smartAccountAddress),
        online:
          a.runtimeType === 'local' &&
          a.lastPollAt !== null &&
          Date.now() - a.lastPollAt.getTime() < 30_000,
        creditScore: Math.round(parseFloat(a.creditScore)),
        rating: a.creditRating,
        jobsCompleted: count('JOB_COMPLETED'),
        earnedUsd,
        streak,
        testsPassed: count('JOB_TESTS_PASSED'),
        testsFailed: count('JOB_TESTS_FAILED'),
        verifiedPassed: count('VERIFIED_TASK_COMPLETED'),
        verifiedFailed: count('VERIFIED_TASK_FAILED'),
      }
    }),
  )

  // How much work is sitting on the market right now.
  let openJobs = 0
  let openBountyUsd = 0
  try {
    const { isLaborMarketConfigured } = await import('@/lib/onchain/config')
    if (isLaborMarketConfigured()) {
      const { readJobs } = await import('@/lib/onchain/labor')
      const jobs = await readJobs()
      const open = jobs.filter((j) => j.status === 'Open')
      openJobs = open.length
      openBountyUsd = open.reduce((s, j) => s + j.bounty, 0)
    }
  } catch {
    /* market unreadable — show zeros rather than stale numbers */
  }

  return { workers, market: { openJobs, openBountyUsd } }
}
