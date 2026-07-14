import { db } from '@/lib/db'
import { agentTask } from '@/lib/db/schema'
import { startAgentTask } from '@/lib/agent-runtime/client'
import { requireAgent, errorResponse, ApiError } from '@/lib/api/agent-access'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

/**
 * POST /api/agents/:id/tasks
 * Starts a task on the Claude-powered runtime and returns immediately.
 * The run happens asynchronously; the runtime calls /api/runtime/callback
 * on completion, which persists events and recalculates credit. The client
 * polls GET /api/agents/:id/tasks/:taskId for the result.
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

    await db.insert(agentTask).values({
      id: taskId,
      userId: agent.userId,
      agentId: agent.id,
      task,
      status: 'running',
    })

    const callbackUrl = `${new URL(request.url).origin}/api/runtime/callback`

    try {
      await startAgentTask({ agentId: agent.id, taskId, task, callbackUrl })
    } catch (error) {
      await db
        .update(agentTask)
        .set({
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          updatedAt: new Date(),
        })
        .where(eq(agentTask.id, taskId))
      throw new ApiError(
        502,
        `Agent runtime unreachable — is it running? (${error instanceof Error ? error.message : String(error)})`,
      )
    }

    return Response.json({ taskId, status: 'running' })
  } catch (error) {
    return errorResponse(error)
  }
}
