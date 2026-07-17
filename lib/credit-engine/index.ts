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
import { getEffectiveCreditRules } from '@/lib/credit-rules'

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

/**
 * Same sum, but across every agent the same user owns — not just one.
 *
 * Without this, a user could leave Agent A's draw unpaid, create a brand
 * new Agent B (fresh address, outstanding[B] == 0 both off-chain and in
 * the on-chain vault), and B would get its own independent credit line
 * with zero regard for A's unpaid balance. creditTransaction.userId
 * already records the owner on every draw, so this is a straight sum —
 * the owner is the real unit of credit exposure, not the agent address.
 */
export async function ownerOutstandingBalance(userId: string): Promise<number> {
  const active = await db
    .select()
    .from(creditTransaction)
    .where(and(eq(creditTransaction.userId, userId), eq(creditTransaction.status, 'active')))
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

  const rules = await getEffectiveCreditRules()
  const assessment = assessCredit(
    events.map((e) => ({
      eventType: e.eventType,
      success: e.success,
      executionTime: e.executionTime,
      tokenCost: e.tokenCost,
      qualityScore: e.qualityScore === null ? null : parseFloat(e.qualityScore),
      createdAt: e.createdAt,
    })),
    { rating: rules.rating, risk: rules.risk },
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

  // agent.availableCredit stays this agent's OWN headroom (limit minus its
  // own outstanding) — risk.ts and other consumers sum this per-agent
  // field across a user's agents, and netting it against owner-wide
  // exposure here would make the same unpaid debt get counted once per
  // agent that owner holds. The owner-wide guard lives at the draw call
  // sites (app/actions/credit.ts, onchain publish below) instead, where
  // "how much can be drawn right now" is actually decided.
  const thisAgentOutstanding = await outstandingBalance(agentId)
  const ownerOutstanding = agentRow?.userId
    ? await ownerOutstandingBalance(agentRow.userId)
    : thisAgentOutstanding
  const otherAgentsOutstanding = Math.max(0, ownerOutstanding - thisAgentOutstanding)
  const available = Math.max(0, assessment.creditLimit - thisAgentOutstanding)

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
  await mirrorOnchain(
    scoreEntryId,
    agentId,
    agentRow?.smartAccountAddress ?? null,
    assessment,
    otherAgentsOutstanding,
  )

  return { ...assessment, previousScore, calculationReason }
}

async function mirrorOnchain(
  scoreEntryId: string,
  agentId: string,
  smartAccountAddress: string | null,
  assessment: CreditAssessment,
  otherAgentsOutstanding: number,
): Promise<void> {
  if (!smartAccountAddress) return
  try {
    const { isOnchainConfigured, onchainEnv } = await import('@/lib/onchain/config')
    if (!isOnchainConfigured()) return
    const { publishLimit, attestCredit } = await import('@/lib/onchain/credit')

    // The vault computes available = registry.creditLimit(agent) −
    // vault.outstanding(agent), and vault.outstanding is keyed per agent
    // address — a fresh agent always reads 0 there. Publishing the limit
    // net of what this owner already owes on OTHER agents is the only
    // on-chain lever that closes that gap without a contract redeploy;
    // this agent's own on-chain outstanding still gets subtracted by the
    // vault as usual, so an agent carrying its own debt isn't double-
    // penalized.
    const publishedLimit = Math.max(0, assessment.creditLimit - otherAgentsOutstanding)
    const registryTxHash = await publishLimit(
      smartAccountAddress as `0x${string}`,
      publishedLimit,
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

    // ERC-8004 mirror: the same recalculated score, published as oracle
    // feedback into the standard Reputation Registry (portable/composable
    // outside this app). Best-effort like everything else here.
    const { publishCreditFeedback } = await import('@/lib/onchain/erc8004')
    await publishCreditFeedback(agentId, assessment.score, assessment.rating)
  } catch (error) {
    console.error('[credit-engine] on-chain mirror failed (non-fatal):', error)
  }
}

export * from './scoring'
