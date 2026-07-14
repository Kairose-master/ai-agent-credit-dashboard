import { db } from '@/lib/db'
import { agentTask } from '@/lib/db/schema'
import { startAgentTask } from '@/lib/agent-runtime/client'
import { requireAgent, errorResponse, ApiError } from '@/lib/api/agent-access'
import { resolveCallbackAuth } from '@/lib/webhook'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

/**
 * POST /api/agents/:id/tasks
 * Starts a task and returns immediately — either on the platform's
 * Claude-powered Python runtime, or (if the agent is configured with a
 * webhook) on the owner's own infrastructure. Either way, execution is
 * async: the runtime/webhook calls /api/runtime/callback on completion,
 * which persists events and recalculates credit. The client polls
 * GET /api/agents/:id/tasks/:taskId for the result.
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

    // If this agent was spawned from a purchased/published template, its
    // custom instructions steer every task it runs (not applied to verified
    // tasks, which must stay uncontaminated for objective grading).
    const effectiveTask = agent.customInstructions
      ? `${agent.customInstructions}\n\n---\n\nTask: ${task}`
      : task

    await db.insert(agentTask).values({
      id: taskId,
      userId: agent.userId,
      agentId: agent.id,
      task,
      status: 'running',
    })

    const callbackUrl = `${new URL(request.url).origin}/api/runtime/callback`
    const isWebhookAgent = agent.runtimeType === 'webhook' && agent.webhookUrl

    try {
      if (isWebhookAgent) {
        await dispatchToWebhook(agent.id, agent.webhookUrl!, taskId, effectiveTask, callbackUrl)
      } else {
        // BYOK: resolve the key this run bills. Only needed for the
        // platform runtime — a webhook agent uses its own resources.
        const { resolveUserAnthropicKey } = await import('@/lib/user-keys')
        let apiKey: string | null
        try {
          apiKey = await resolveUserAnthropicKey(agent.userId)
        } catch (error) {
          throw new ApiError(402, error instanceof Error ? error.message : String(error))
        }
        await startAgentTask({ agentId: agent.id, taskId, task: effectiveTask, callbackUrl, apiKey })
      }
    } catch (error) {
      await db
        .update(agentTask)
        .set({
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          updatedAt: new Date(),
        })
        .where(eq(agentTask.id, taskId))
      if (error instanceof ApiError) throw error
      throw new ApiError(
        502,
        `${isWebhookAgent ? 'Webhook' : 'Agent runtime'} unreachable (${error instanceof Error ? error.message : String(error)})`,
      )
    }

    return Response.json({ taskId, status: 'running' })
  } catch (error) {
    return errorResponse(error)
  }
}

/** POST the task to the agent owner's own HTTP endpoint. No code from the
 *  webhook ever runs on our servers — we only send a task and wait for the
 *  callback, authenticated with this agent's own secret. */
async function dispatchToWebhook(
  agentId: string,
  webhookUrl: string,
  taskId: string,
  task: string,
  callbackUrl: string,
) {
  const auth = await resolveCallbackAuth(agentId)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth.required) headers['X-Runtime-Secret'] = auth.secret

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ agent_id: agentId, task_id: taskId, task, callback_url: callbackUrl }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`Webhook responded ${response.status}: ${(await response.text()).slice(0, 300)}`)
  }
}
