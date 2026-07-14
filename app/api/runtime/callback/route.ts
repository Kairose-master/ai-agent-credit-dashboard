import { db } from '@/lib/db'
import { agentEvent, agentTask } from '@/lib/db/schema'
import { recalculateCredit } from '@/lib/credit-engine'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'

export const maxDuration = 60

/**
 * POST /api/runtime/callback
 * Called by the Python runtime when a task finishes. Authenticated with the
 * shared secret (not a user session). Persists the behavioral events and
 * recalculates the agent's credit, then records the result on the task row
 * for the dashboard to poll.
 *
 * Processing is claimed atomically (running → processing) so a retried
 * callback can't double-insert events.
 */
export async function POST(request: Request) {
  const expected = process.env.RUNTIME_SHARED_SECRET ?? ''
  if (expected && request.headers.get('x-runtime-secret') !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const taskId = body?.task_id as string | undefined
  if (!taskId) return Response.json({ error: 'Missing task_id' }, { status: 400 })

  // Atomically claim the task so concurrent/retried callbacks process once.
  const claimed = await db
    .update(agentTask)
    .set({ status: 'processing', updatedAt: new Date() })
    .where(and(eq(agentTask.id, taskId), eq(agentTask.status, 'running')))
    .returning()

  if (claimed.length === 0) {
    // Already processed (or unknown task) — acknowledge idempotently.
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
