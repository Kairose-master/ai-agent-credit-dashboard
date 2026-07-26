/**
 * The default sweep: finds loans past due + grace and makes the default REAL —
 * status flipped, the REPAYMENT_DEFAULTED event written (the one the scoring
 * engine was designed around but nothing ever produced), the score
 * recalculated, and the fact announced on the platform feed.
 *
 * Idempotent by construction: the event id is keyed on the loan, so webhook-
 * style re-runs and concurrent sweeps cannot double-punish. Throttled and
 * best-effort like the settlement sweeps — safe from any hot path.
 */
import { db } from '@/lib/db'
import { agentEvent, creditTransaction } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { GRACE_DAYS, loanPhase } from '@/lib/loan-terms'

const SWEEP_COOLDOWN_MS = 60_000
let lastSweepAt = 0

export async function sweepDefaultedLoans(now = new Date()): Promise<number> {
  if (now.getTime() - lastSweepAt < SWEEP_COOLDOWN_MS) return 0
  lastSweepAt = now.getTime()

  let defaulted = 0
  try {
    await (await import('@/lib/db/ensure-columns')).ensureCreditTransactionColumns()

    const open = await db
      .select()
      .from(creditTransaction)
      .where(and(eq(creditTransaction.status, 'active'), eq(creditTransaction.type, 'credit_draw')))

    for (const loan of open) {
      if (loanPhase(now, loan.dueAt, GRACE_DAYS) !== 'defaulted') continue
      try {
        // Claim atomically: only the sweep instance that flips active →
        // defaulted writes the event, so a concurrent sweep is a no-op.
        const claimed = await db
          .update(creditTransaction)
          .set({ status: 'defaulted', defaultedAt: now, updatedAt: now })
          .where(and(eq(creditTransaction.id, loan.id), eq(creditTransaction.status, 'active')))
          .returning()
        if (claimed.length === 0) continue

        await db.insert(agentEvent).values({
          id: nanoid(),
          agentId: loan.fromAgentId,
          taskId: `default-${loan.id}`,
          eventType: 'REPAYMENT_DEFAULTED',
          success: false,
          executionTime: 0,
          tokenCost: 0,
          qualityScore: '0.000',
          detail: {
            amount: loan.amount,
            transactionId: loan.id,
            dueAt: loan.dueAt?.toISOString() ?? null,
            graceDays: GRACE_DAYS,
          },
        })

        const { recalculateCredit } = await import('@/lib/credit-engine')
        await recalculateCredit(loan.fromAgentId)

        const { logPlatformEvent } = await import('@/lib/platform-feed')
        await logPlatformEvent(
          'LOAN_DEFAULTED',
          `A $${parseFloat(loan.amount).toLocaleString()} credit draw went ${GRACE_DAYS} days past due and defaulted — the borrower's score takes the designed hit`,
        ).catch(() => {})

        defaulted++
      } catch (error) {
        console.error(`[loan-sweep] defaulting loan ${loan.id} failed:`, error)
      }
    }
  } catch (error) {
    console.error('[loan-sweep] sweep failed:', error)
  }
  return defaulted
}
