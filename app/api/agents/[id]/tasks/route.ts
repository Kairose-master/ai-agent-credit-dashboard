import { db } from '@/lib/db'
import { agentEvent } from '@/lib/db/schema'
import { nanoid } from 'nanoid'
import { runAgentTask } from '@/lib/agent-runtime/client'
import { recalculateCredit } from '@/lib/credit-engine'
import { requireAgent, errorResponse, ApiError } from '@/lib/api/agent-access'

export const maxDuration = 300

/**
 * POST /api/agents/:id/tasks
 * The end-to-end vertical slice:
 *   1. receive user task
 *   2. execute it on the Claude-powered agent runtime
 *   3. persist the structured behavioral events
 *   4. recalculate the credit score from the full event ledger
 *   5. return the task result plus the updated credit state
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const agent = await requireAgent(id)

    const body = await request.json().catch(() => null)
    const task = typeof body?.task === 'string' ? body.task.trim() : ''
    if (!task) throw new ApiError(400, 'Request body must include a non-empty "task" string')
    if (task.length > 4000) throw new ApiError(400, 'Task must be 4000 characters or fewer')

    const taskId = `task-${nanoid(10)}`

    let run
    try {
      run = await runAgentTask({ agentId: agent.id, taskId, task })
    } catch (error) {
      throw new ApiError(
        502,
        `Agent runtime unreachable — is it running? (${error instanceof Error ? error.message : String(error)})`,
      )
    }

    if (run.events.length > 0) {
      await db.insert(agentEvent).values(
        run.events.map((event) => ({
          id: nanoid(),
          agentId: agent.id,
          taskId,
          eventType: event.event_type,
          success: event.success,
          executionTime: event.execution_time,
          tokenCost: event.token_cost,
          qualityScore: event.quality_score === null ? null : event.quality_score.toFixed(3),
          detail: event.detail,
        })),
      )
    }

    const credit = await recalculateCredit(agent.id)

    return Response.json({
      taskId,
      result: {
        success: run.success,
        output: run.output,
        plan: run.plan,
        qualityScore: run.quality_score,
        evaluation: run.evaluation ?? null,
        executionTime: run.execution_time,
        tokenCost: run.token_cost,
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
    })
  } catch (error) {
    return errorResponse(error)
  }
}
