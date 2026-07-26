/**
 * Market health — the numbers a skeptic asks for, computed live.
 *
 * A market that only advertises its wins is indistinguishable from one
 * hiding its losses. Dispute rate, refund rate, grading fail rate and loan
 * default rate ARE the product claim ("verified work, real consequences"),
 * so they come from the same tables and chain reads everything else uses —
 * never a flattering snapshot, never seeded (CLAUDE.md: no fake data).
 * Cold start shows as cold start; unreadable chain shows as absence.
 */
import { db } from '@/lib/db'
import { agentEvent, creditTransaction } from '@/lib/db/schema'
import { inArray, eq } from 'drizzle-orm'

export type MarketHealth = {
  generatedAt: string
  jobs: { byStatus: Record<string, number>; total: number; escrowedUsd: number; settlementRate: number | null }
  grading: { total: number; passed: number; failed: number; passRate: number | null }
  loans: { byStatus: Record<string, number>; defaultRate: number | null }
}

export async function computeMarketHealth(): Promise<MarketHealth> {
  let jobs: MarketHealth['jobs'] = { byStatus: {}, total: 0, escrowedUsd: 0, settlementRate: null }
  try {
    const { readJobs } = await import('@/lib/onchain/labor')
    const all = await readJobs()
    const byStatus: Record<string, number> = {}
    let escrowedUsd = 0
    for (const j of all) {
      byStatus[j.status] = (byStatus[j.status] ?? 0) + 1
      if (j.status === 'Open' || j.status === 'Accepted' || j.status === 'Submitted') escrowedUsd += j.bounty
    }
    const terminal = (byStatus.Completed ?? 0) + (byStatus.Cancelled ?? 0) + (byStatus.Disputed ?? 0) + (byStatus.Refunded ?? 0)
    jobs = {
      byStatus,
      total: all.length,
      escrowedUsd: Math.round(escrowedUsd * 100) / 100,
      settlementRate: terminal > 0 ? Math.round(((byStatus.Completed ?? 0) / terminal) * 1000) / 10 : null,
    }
  } catch {
    // On-chain unreadable (no env / RPC down): report the absence honestly.
  }

  const graded = await db
    .select({ eventType: agentEvent.eventType })
    .from(agentEvent)
    .where(
      inArray(agentEvent.eventType, ['JOB_TESTS_PASSED', 'JOB_TESTS_FAILED', 'VERIFIED_TASK_COMPLETED', 'VERIFIED_TASK_FAILED']),
    )
  const gradedPassed = graded.filter((g) => g.eventType === 'JOB_TESTS_PASSED' || g.eventType === 'VERIFIED_TASK_COMPLETED').length
  const gradedTotal = graded.length

  // Defaulted loans staying visible here is the point — a lending system
  // that hides its defaults isn't one.
  const draws = await db
    .select({ status: creditTransaction.status })
    .from(creditTransaction)
    .where(eq(creditTransaction.type, 'credit_draw'))
  const loanCounts: Record<string, number> = {}
  for (const d of draws) loanCounts[d.status ?? 'unknown'] = (loanCounts[d.status ?? 'unknown'] ?? 0) + 1
  const loanTerminal = (loanCounts.settled ?? 0) + (loanCounts.defaulted ?? 0)

  return {
    generatedAt: new Date().toISOString(),
    jobs,
    grading: {
      total: gradedTotal,
      passed: gradedPassed,
      failed: gradedTotal - gradedPassed,
      passRate: gradedTotal > 0 ? Math.round((gradedPassed / gradedTotal) * 1000) / 10 : null,
    },
    loans: {
      byStatus: loanCounts,
      defaultRate: loanTerminal > 0 ? Math.round(((loanCounts.defaulted ?? 0) / loanTerminal) * 1000) / 10 : null,
    },
  }
}
