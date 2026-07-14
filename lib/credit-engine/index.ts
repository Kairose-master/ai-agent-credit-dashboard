/**
 * Credit Scoring Engine — persistence layer.
 *
 * recalculateCredit() is the single entry point used by API routes:
 * it reads the agent's full behavioral ledger, delegates the financial
 * math to scoring.ts, appends a credit_scores history row, and updates
 * the agent's live credit state.
 */
import { db } from '@/lib/db'
import { agent, agentEvent, creditScoreEntry, creditTransaction } from '@/lib/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { assessCredit, buildCalculationReason, type CreditAssessment } from './scoring'

/** Sum of credit drawn but not yet repaid — reduces available credit. */
async function outstandingBalance(agentId: string): Promise<number> {
  const active = await db
    .select()
    .from(creditTransaction)
    .where(and(eq(creditTransaction.fromAgentId, agentId), eq(creditTransaction.status, 'active')))
  return active
    .filter((t) => t.type === 'credit_draw')
    .reduce((sum, t) => sum + parseFloat(t.amount), 0)
}

export type CreditState = CreditAssessment & {
  previousScore: number | null
  calculationReason: string
}

export async function recalculateCredit(agentId: string): Promise<CreditState> {
  const events = await db
    .select()
    .from(agentEvent)
    .where(eq(agentEvent.agentId, agentId))

  const assessment = assessCredit(
    events.map((e) => ({
      eventType: e.eventType,
      success: e.success,
      executionTime: e.executionTime,
      tokenCost: e.tokenCost,
      qualityScore: e.qualityScore === null ? null : parseFloat(e.qualityScore),
      createdAt: e.createdAt,
    })),
  )

  const [previous] = await db
    .select()
    .from(creditScoreEntry)
    .where(eq(creditScoreEntry.agentId, agentId))
    .orderBy(desc(creditScoreEntry.createdAt))
    .limit(1)

  const previousScore = previous ? previous.score : null
  const calculationReason = buildCalculationReason(assessment, previousScore)

  await db.insert(creditScoreEntry).values({
    id: nanoid(),
    agentId,
    score: assessment.score,
    rating: assessment.rating,
    creditLimit: assessment.creditLimit.toString(),
    riskLevel: assessment.riskLevel,
    calculationReason,
    breakdown: assessment.breakdown,
  })

  // Available credit is the new limit minus whatever is still drawn.
  const outstanding = await outstandingBalance(agentId)
  const available = Math.max(0, assessment.creditLimit - outstanding)

  await db
    .update(agent)
    .set({
      creditScore: assessment.score.toString(),
      creditRating: assessment.rating,
      riskRating: assessment.rating,
      riskLevel: assessment.riskLevel,
      totalCreditLine: assessment.creditLimit.toString(),
      availableCredit: available.toString(),
      updatedAt: new Date(),
    })
    .where(eq(agent.id, agentId))

  return { ...assessment, previousScore, calculationReason }
}

export * from './scoring'
