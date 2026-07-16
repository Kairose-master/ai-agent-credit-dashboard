/**
 * Shared "start a real agent run" logic — used by both the ad-hoc task API
 * route (POST /api/agents/:id/tasks) and server actions that need to kick
 * off a genuine agent execution (e.g. a Labor Market job's worker actually
 * doing the work). One code path, so BYOK resolution / webhook dispatch /
 * custom-instructions prefixing can't drift between callers.
 */
import { db } from '@/lib/db'
import { agentTask, type agent as agentTable } from '@/lib/db/schema'
import { and, eq, inArray, lt } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { startAgentTask } from '@/lib/agent-runtime/client'
import { resolveCallbackAuth } from '@/lib/webhook'

type AgentRow = typeof agentTable.$inferSelect

// 30 minutes: generous enough for slow local reasoning models (deepseek-r1
// on consumer GPUs legitimately thinks for 10+ minutes) while still
// eventually failing runs whose runtime actually died.
const STUCK_TASK_TIMEOUT_MS = 30 * 60 * 1000

/**
 * A task can get stuck in 'running'/'processing' forever if the runtime
 * process dies before it calls back — e.g. a mid-run redeploy kills the
 * Python runtime's background thread, or a webhook agent's own server
 * crashes. There's no heartbeat/retry, so nothing else would ever notice.
 *
 * Call this from any read path that surfaces task status (it's a single
 * cheap UPDATE...WHERE, safe to call on every poll). A genuine callback
 * landing at the exact same moment races this on the same row — whichever
 * UPDATE commits first wins. In the rare case this one wins right as a real
 * result was arriving, that result is dropped (matches the existing
 * idempotent-callback behavior: /api/runtime/callback already no-ops with
 * `{status: 'ignored'}` when it can't claim a 'running' row). Timeout is 10
 * minutes, generous for a normal task, so this window is narrow.
 */
export async function reapStuckTasks(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_TASK_TIMEOUT_MS)
  await db
    .update(agentTask)
    .set({
      status: 'failed',
      error: `Timed out waiting for the runtime (no response after ${STUCK_TASK_TIMEOUT_MS / 60_000} minutes) — it may have crashed or been redeployed mid-run.`,
      updatedAt: new Date(),
    })
    .where(and(inArray(agentTask.status, ['running', 'processing']), lt(agentTask.updatedAt, cutoff)))

  // Queued tasks for 'local' agents that no worker ever claimed — the
  // owner's worker process is probably not running.
  await db
    .update(agentTask)
    .set({
      status: 'failed',
      error: `No local worker claimed this task within ${STUCK_TASK_TIMEOUT_MS / 60_000} minutes — is your ledgermind-worker process running?`,
      updatedAt: new Date(),
    })
    .where(and(eq(agentTask.status, 'queued'), lt(agentTask.updatedAt, cutoff)))
}

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

  // 'local' agents are pull-based: their worker process polls
  // /api/worker/poll and claims queued tasks — we never connect to them
  // (that reversed direction is what makes local hosting tunnel-free).
  // The stored task text is the effective (instruction-prefixed) one, since
  // no dispatch call carries it.
  if (agent.runtimeType === 'local') {
    await db.insert(agentTask).values({
      id: taskId,
      userId: agent.userId,
      agentId: agent.id,
      task: effectiveTask,
      status: 'queued',
    })
    return { taskId }
  }

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
