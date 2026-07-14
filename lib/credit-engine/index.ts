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

  const [agentRow] = await db.select().from(agent).where(eq(agent.id, agentId))

  const scoreEntryId = nanoid()
  await db.insert(creditScoreEntry).values({
    id: scoreEntryId,
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

  // Best-effort on-chain mirror: publish the limit to the registry and attest
  // the score via EAS. Never blocks or fails the off-chain recalculation.
  await mirrorOnchain(scoreEntryId, agentId, agentRow?.smartAccountAddress ?? null, assessment)

  return { ...assessment, previousScore, calculationReason }
}

async function mirrorOnchain(
  scoreEntryId: string,
  agentId: string,
  smartAccountAddress: string | null,
  assessment: CreditAssessment,
): Promise<void> {
  if (!smartAccountAddress) return
  try {
    const { isOnchainConfigured, onchainEnv } = await import('@/lib/onchain/config')
    if (!isOnchainConfigured()) return
    const { publishLimit, attestCredit } = await import('@/lib/onchain/credit')

    const registryTxHash = await publishLimit(
      smartAccountAddress as `0x${string}`,
      assessment.creditLimit,
      assessment.score,
    )

    let attestationTxHash: string | null = null
    if (onchainEnv.easSchemaUid) {
      attestationTxHash = await attestCredit({
        agentId,
        agentAddress: smartAccountAddress as `0x${string}`,
        score: assessment.score,
        rating: assessment.rating,
        creditLimitUsd: assessment.creditLimit,
        riskLevel: assessment.riskLevel,
      })
    }

    await db
      .update(creditScoreEntry)
      .set({ registryTxHash, attestationTxHash })
      .where(eq(creditScoreEntry.id, scoreEntryId))
  } catch (error) {
    console.error('[credit-engine] on-chain mirror failed (non-fatal):', error)
  }
}

export * from './scoring'
