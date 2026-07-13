/**
 * Credit Scoring Engine — persistence layer.
 *
 * recalculateCredit() is the single entry point used by API routes:
 * it reads the agent's full behavioral ledger, delegates the financial
 * math to scoring.ts, appends a credit_scores history row, and updates
 * the agent's live credit state.
 */
import { db } from '@/lib/db'
import { agent, agentEvent, creditScoreEntry } from '@/lib/db/schema'
import { desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { assessCredit, buildCalculationReason, type CreditAssessment } from './scoring'

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

  await db
    .update(agent)
    .set({
      creditScore: assessment.score.toString(),
      creditRating: assessment.rating,
      riskRating: assessment.rating,
      riskLevel: assessment.riskLevel,
      totalCreditLine: assessment.creditLimit.toString(),
      availableCredit: assessment.creditLimit.toString(),
      updatedAt: new Date(),
    })
    .where(eq(agent.id, agentId))

  return { ...assessment, previousScore, calculationReason }
}

export * from './scoring'
