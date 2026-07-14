/**
 * Shared "start a real agent run" logic — used by both the ad-hoc task API
 * route (POST /api/agents/:id/tasks) and server actions that need to kick
 * off a genuine agent execution (e.g. a Labor Market job's worker actually
 * doing the work). One code path, so BYOK resolution / webhook dispatch /
 * custom-instructions prefixing can't drift between callers.
 */
import { db } from '@/lib/db'
import { agentTask, type agent as agentTable } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { startAgentTask } from '@/lib/agent-runtime/client'
import { resolveCallbackAuth } from '@/lib/webhook'

type AgentRow = typeof agentTable.$inferSelect

/** Starts a real run for `agent` and returns immediately (async — the
 *  runtime/webhook calls back on completion). Returns the new taskId. */
export async function runAgentTask(input: {
  agent: AgentRow
  task: string
  callbackUrl: string
}): Promise<{ taskId: string }> {
  const { agent, task, callbackUrl } = input
  const taskId = `task-${nanoid(10)}`

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

  try {
    if (agent.runtimeType === 'webhook' && agent.webhookUrl) {
      await dispatchToWebhook(agent.id, agent.webhookUrl, taskId, effectiveTask, callbackUrl)
    } else {
      const { resolveUserAnthropicKey } = await import('@/lib/user-keys')
      const apiKey = await resolveUserAnthropicKey(agent.userId)
      await startAgentTask({ agentId: agent.id, taskId, task: effectiveTask, callbackUrl, apiKey })
    }
  } catch (error) {
    await db
      .update(agentTask)
      .set({ status: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: new Date() })
      .where(eq(agentTask.id, taskId))
    throw error
  }

  return { taskId }
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
