/**
 * The Labor Index — a real, honest, platform-wide snapshot of the AI
 * agent labor market: supply (agent count, aggregate credit, rating mix),
 * demand (open jobs, bounty value waiting), and quality (independent-
 * grading pass rate, lifetime payout). Every number is a live aggregate
 * over the exact same tables the dashboard and credit-scoring engine use
 * — nothing seeded, nothing invented to look impressive to whoever pays
 * to read it (see /api/market/index, the paid endpoint this feeds).
 *
 * This module is deliberately kept free of anything token/derivative-
 * specific — it only ever answers "what is true about the market right
 * now." That's the whole point: this is the data layer other things get
 * built on top of later (a cash-settled contract referencing this index,
 * a third-party protocol using it as an oracle), not the product itself.
 */
import { db } from '@/lib/db'
import { agent, agentEvent } from '@/lib/db/schema'
import { eq, inArray, sql } from 'drizzle-orm'

const RATING_BANDS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'C', 'D', 'unrated']
const GRADED_PASS = new Set(['JOB_TESTS_PASSED', 'VERIFIED_TASK_COMPLETED'])
const GRADED_ALL = [...GRADED_PASS, 'JOB_TESTS_FAILED', 'VERIFIED_TASK_FAILED']

export async function computeLaborIndex() {
  const [portfolioStats] = await db
    .select({
      agentCount: sql<number>`count(*)`,
      avgScore: sql<number>`avg(${agent.creditScore})`,
      totalCreditLine: sql<number>`coalesce(sum(${agent.totalCreditLine}), 0)`,
    })
    .from(agent)

  const agents = await db.select({ creditRating: agent.creditRating }).from(agent)
  const ratingCounts = new Map<string, number>()
  for (const a of agents) {
    const band = a.creditRating ?? 'unrated'
    ratingCounts.set(band, (ratingCounts.get(band) ?? 0) + 1)
  }
  const totalAgents = agents.length

  const gradedEvents = await db
    .select({ eventType: agentEvent.eventType })
    .from(agentEvent)
    .where(inArray(agentEvent.eventType, GRADED_ALL))
  const gradedTotal = gradedEvents.length
  const gradedPassed = gradedEvents.filter((e) => GRADED_PASS.has(e.eventType)).length

  const completedEvents = await db
    .select({ detail: agentEvent.detail })
    .from(agentEvent)
    .where(eq(agentEvent.eventType, 'JOB_COMPLETED'))
  const totalPaidOutUsd = completedEvents.reduce((sum, e) => {
    const bounty = (e.detail as { bounty?: number } | null)?.bounty
    return sum + (typeof bounty === 'number' ? bounty : 0)
  }, 0)

  // Open demand currently sitting on the market — best-effort: an
  // unreadable chain reports zero rather than a stale/guessed number.
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
    /* market unreadable right now */
  }

  return {
    generatedAt: new Date().toISOString(),
    supply: {
      agentCount: Number(portfolioStats?.agentCount ?? 0),
      avgCreditScore: portfolioStats?.avgScore ? Math.round(Number(portfolioStats.avgScore)) : null,
      totalCreditLineUsd: Number(portfolioStats?.totalCreditLine ?? 0),
      ratingDistribution: RATING_BANDS.map((band) => ({
        band,
        count: ratingCounts.get(band) ?? 0,
        share: totalAgents > 0 ? Math.round(((ratingCounts.get(band) ?? 0) / totalAgents) * 1000) / 1000 : 0,
      })).filter((r) => r.count > 0),
    },
    demand: {
      openJobs,
      openBountyUsd,
    },
    quality: {
      completedJobsLifetime: completedEvents.length,
      totalPaidOutUsd,
      // Share of independently-graded outcomes (acceptance tests +
      // verified tasks) that came back a pass — the closest thing this
      // market has to a real "default rate" proxy: null, not 0, when
      // there isn't enough graded history yet to mean anything.
      gradedPassRate: gradedTotal > 0 ? Math.round((gradedPassed / gradedTotal) * 1000) / 1000 : null,
      gradedEventsTotal: gradedTotal,
    },
  }
}

export type LaborIndex = Awaited<ReturnType<typeof computeLaborIndex>>
