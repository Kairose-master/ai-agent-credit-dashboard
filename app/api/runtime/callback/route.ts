import { db } from '@/lib/db'
import { agentEvent, agentTask, verifiableTask } from '@/lib/db/schema'
import { recalculateCredit } from '@/lib/credit-engine'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { extractAnswer } from '@/lib/verifiable/problems'
import { resolveCallbackAuth } from '@/lib/webhook'

// Verified-task settlement runs two UserOps; allow time for bundler inclusion.
export const maxDuration = 300

/**
 * POST /api/runtime/callback
 * Called by the Python runtime OR a user's own BYO-agent webhook when a task
 * finishes. Persists the behavioral events and recalculates the agent's
 * credit, then records the result on the task row for the dashboard to poll.
 *
 * Auth is resolved PER-TASK'S OWNING AGENT (not one global secret): a
 * platform-runtime task requires RUNTIME_SHARED_SECRET; a webhook-runtime
 * task requires that agent's own secret — so one agent's webhook can never
 * forge a callback for another agent's task.
 *
 * Processing is claimed atomically (running → processing) so a retried
 * callback can't double-insert events.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const taskId = body?.task_id as string | undefined
  if (!taskId) return Response.json({ error: 'Missing task_id' }, { status: 400 })

  const [taskRow] = await db.select().from(agentTask).where(eq(agentTask.id, taskId))
  if (!taskRow) return Response.json({ status: 'ignored' }) // unknown task — idempotent no-op

  const auth = await resolveCallbackAuth(taskRow.agentId)
  if (auth.required && request.headers.get('x-runtime-secret') !== auth.secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Atomically claim the task so concurrent/retried callbacks process once.
  const claimed = await db
    .update(agentTask)
    .set({ status: 'processing', updatedAt: new Date() })
    .where(and(eq(agentTask.id, taskId), eq(agentTask.status, 'running')))
    .returning()

  if (claimed.length === 0) {
    // Already processed — acknowledge idempotently.
    return Response.json({ status: 'ignored' })
  }

  const agentId = claimed[0].agentId
  const events = Array.isArray(body?.events) ? body.events : []

  try {
    if (events.length > 0) {
      await db.insert(agentEvent).values(
        events.map((event: any) => ({
          id: nanoid(),
          agentId,
          taskId,
          eventType: String(event.event_type),
          success: Boolean(event.success),
          executionTime: Number(event.execution_time) || 0,
          tokenCost: Number(event.token_cost) || 0,
          qualityScore:
            event.quality_score === null || event.quality_score === undefined
              ? null
              : Number(event.quality_score).toFixed(3),
          detail: event.detail ?? {},
        })),
      )
    }

    // Verified task? Grade against the hidden answer and settle the escrow.
    await settleVerifiedTask(taskId, agentId, String(body?.output ?? ''))

    const credit = await recalculateCredit(agentId)

    await db
      .update(agentTask)
      .set({
        status: 'completed',
        output: String(body?.output ?? ''),
        result: {
          success: Boolean(body?.success),
          plan: body?.plan ?? '',
          qualityScore: Number(body?.quality_score) || 0,
          evaluation: body?.evaluation ?? null,
          executionTime: Number(body?.execution_time) || 0,
          tokenCost: Number(body?.token_cost) || 0,
        },
        credit: {
          previousScore: credit.previousScore,
          score: credit.score,
          rating: credit.rating,
          creditLimit: credit.creditLimit,
          riskLevel: credit.riskLevel,
          calculationReason: credit.calculationReason,
          breakdown: credit.breakdown,
        },
        updatedAt: new Date(),
      })
      .where(eq(agentTask.id, taskId))

    return Response.json({ status: 'ok' })
  } catch (error) {
    await db
      .update(agentTask)
      .set({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(agentTask.id, taskId))
    console.error('[runtime/callback] Failed to process task', taskId, error)
    return Response.json({ error: 'Failed to process callback' }, { status: 500 })
  }
}

/**
 * If this agent run was the solve of a verified task: grade the output
 * against the hidden ground-truth answer (grader ≠ solver), and on a correct
 * answer settle the on-chain escrow via commit-reveal from the solver's
 * smart account. Both outcomes are recorded as VERIFIED_TASK_* events — the
 * factual quality signal the credit engine weighs above self-evaluation.
 */
async function settleVerifiedTask(agentTaskId: string, solverAgentId: string, output: string) {
  const [row] = await db
    .select()
    .from(verifiableTask)
    .where(eq(verifiableTask.agentTaskId, agentTaskId))
  if (!row || row.status !== 'solving') return

  const submitted = extractAnswer(output)
  const correct = submitted !== null && submitted === row.answer

  try {
    if (correct && row.onchainId) {
      await db
        .update(verifiableTask)
        .set({ status: 'settling', submittedAnswer: submitted, updatedAt: new Date() })
        .where(eq(verifiableTask.id, row.id))

      const { commitAndReveal } = await import('@/lib/onchain/verified')
      const { revealTx } = await commitAndReveal(
        row.solverAgentId,
        row.onchainId,
        row.answer,
        row.salt as `0x${string}`,
      )

      await db
        .update(verifiableTask)
        .set({ status: 'completed', settleTxHash: revealTx, updatedAt: new Date() })
        .where(eq(verifiableTask.id, row.id))

      await db.insert(agentEvent).values({
        id: nanoid(),
        agentId: solverAgentId,
        taskId: `verified-${row.id}`,
        eventType: 'VERIFIED_TASK_COMPLETED',
        success: true,
        executionTime: 0,
        tokenCost: 0,
        qualityScore: '1.000', // graded fact, not self-opinion
        detail: {
          difficulty: row.difficulty,
          bounty: row.bountyUsd,
          problem: row.problem,
          txHash: revealTx,
          onchain: true,
        },
      })
    } else {
      await db
        .update(verifiableTask)
        .set({ status: 'failed', submittedAnswer: submitted, updatedAt: new Date() })
        .where(eq(verifiableTask.id, row.id))

      await db.insert(agentEvent).values({
        id: nanoid(),
        agentId: solverAgentId,
        taskId: `verified-${row.id}`,
        eventType: 'VERIFIED_TASK_FAILED',
        success: false,
        executionTime: 0,
        tokenCost: 0,
        qualityScore: '0.000',
        detail: {
          difficulty: row.difficulty,
          problem: row.problem,
          submitted: submitted ?? '(no FINAL_ANSWER found)',
        },
      })
    }
  } catch (error) {
    console.error('[runtime/callback] verified settlement failed:', error)
    await db
      .update(verifiableTask)
      .set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(verifiableTask.id, row.id))
  }
}
