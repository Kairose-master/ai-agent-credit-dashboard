/**
 * Credit Scoring Engine — persistence layer.
 *
 * recalculateCredit() is the single entry point used by API routes:
 * it reads the agent's full behavioral ledger, delegates the financial
 * math to scoring.ts, appends a credit_scores history row, and updates
 * the agent's live credit state.
 */
import { db } from '@/lib/db'
import { agent, agentEvent, creditScoreEntry, creditTransaction, jobSpec } from '@/lib/db/schema'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { assessCredit, buildCalculationReason, collateralizedCreditLimit, type CreditAssessment } from './scoring'
import { getEffectiveCreditRules } from '@/lib/credit-rules'

/**
 * A task's self-reported TASK_COMPLETED/TASK_FAILED event only knows "did
 * the runtime produce non-empty output" — it has no idea whether that
 * output was actually CORRECT. For an auto-graded Labor Market job, the
 * platform's own acceptance-test run (JOB_TESTS_PASSED/FAILED) is the real
 * verdict on the SAME task, and it's a fact, not an opinion (see Claude.md
 * — "the two grades of credit signal"). Without this correction, a job
 * whose acceptance tests genuinely FAILED still counted as a "completed"
 * task toward Performance (40% weight) and Reputation (20%) — the runtime
 * produced *some* text, so the self-report said success — while the real
 * failure only dinged Risk (10%) via testsFailed. A confidently-wrong
 * deliverable could net a credit INCREASE despite failing grading, which
 * defeats the entire point of grading being authoritative.
 *
 * Fix: look up which of this agent's tasks were auto-graded, and overwrite
 * the self-reported event's outcome with the graded verdict before scoring
 * — the fact replaces the opinion for that specific task, rather than the
 * two being summed as if independent.
 */
async function overrideSelfReportsWithGradedVerdicts<
  T extends { eventType: string; success: boolean; taskId: string },
>(agentId: string, events: T[]): Promise<T[]> {
  const gradedSpecs = await db
    .select({ agentTaskId: jobSpec.agentTaskId, testResult: jobSpec.testResult })
    .from(jobSpec)
    .where(and(eq(jobSpec.workerAgentId, agentId), isNotNull(jobSpec.testCode)))

  const verdictByTaskId = new Map<string, boolean>()
  for (const s of gradedSpecs) {
    const passed = s.testResult?.passed
    if (s.agentTaskId && (passed === true || passed === false)) {
      verdictByTaskId.set(s.agentTaskId, passed)
    }
  }
  if (verdictByTaskId.size === 0) return events

  return events.map((e) => {
    const passed = verdictByTaskId.get(e.taskId)
    if (passed === undefined || (e.eventType !== 'TASK_COMPLETED' && e.eventType !== 'TASK_FAILED')) return e
    return { ...e, eventType: passed ? 'TASK_COMPLETED' : 'TASK_FAILED', success: passed }
  })
}

/** Sum of credit drawn but not yet repaid — reduces available credit. */
async function outstandingBalance(agentId: string): Promise<number> {
  // Defaulted loans MUST stay on the books: with the naive status === 'active'
  // filter, marking a loan defaulted made the debt vanish — so a default
  // would have RAISED the borrower's available credit (lib/loan-terms.ts).
  const { isOutstandingStatus } = await import('@/lib/loan-terms')
  const rows = await db
    .select()
    .from(creditTransaction)
    .where(eq(creditTransaction.fromAgentId, agentId))
  return rows
    .filter((t) => t.type === 'credit_draw' && isOutstandingStatus(t.status))
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
  const { isOutstandingStatus } = await import('@/lib/loan-terms')
  const rows = await db
    .select()
    .from(creditTransaction)
    .where(eq(creditTransaction.userId, userId))
  return rows
    .filter((t) => t.type === 'credit_draw' && isOutstandingStatus(t.status))
    .reduce((sum, t) => sum + parseFloat(t.amount), 0)
}

export type CreditState = CreditAssessment & {
  previousScore: number | null
  calculationReason: string
}

export async function recalculateCredit(agentId: string): Promise<CreditState> {
  const rawEvents = await db
    .select()
    .from(agentEvent)
    .where(eq(agentEvent.agentId, agentId))
  const events = await overrideSelfReportsWithGradedVerdicts(agentId, rawEvents)

  const rules = await getEffectiveCreditRules()
  const assessment = assessCredit(
    events.map((e) => {
      const d = (e.detail ?? {}) as Record<string, unknown>
      return {
        eventType: e.eventType,
        success: e.success,
        executionTime: e.executionTime,
        tokenCost: e.tokenCost,
        qualityScore: e.qualityScore === null ? null : parseFloat(e.qualityScore),
        createdAt: e.createdAt,
        counterparty: typeof d.requesterAgentId === 'string' ? d.requesterAgentId : null,
        grader: typeof d.grader === 'string' ? d.grader : null,
        counterpartyScore: typeof d.requesterScore === 'number' ? d.requesterScore : null,
      }
    }),
    { rating: rules.rating, risk: rules.risk },
  )

  // Lending is where the platform can actually lose money, so the limit the
  // score curve proposes is capped by collateral the halving math makes
  // expensive to fake: settled escrow volume, discounted per repeat
  // counterparty and by counterparty credibility (see scoring.ts). Score
  // stays as-is — this caps only borrowing power.
  const settledTrades = events
    .filter((e) => e.eventType === 'JOB_COMPLETED')
    .map((e) => {
      const d = (e.detail ?? {}) as Record<string, unknown>
      return {
        amountUsd: typeof d.bounty === 'number' ? d.bounty : 0,
        counterparty: typeof d.requesterAgentId === 'string' ? d.requesterAgentId : null,
        counterpartyScore: typeof d.requesterScore === 'number' ? d.requesterScore : null,
        createdAt: e.createdAt,
      }
    })
  assessment.creditLimit = collateralizedCreditLimit(assessment.creditLimit, settledTrades)

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
