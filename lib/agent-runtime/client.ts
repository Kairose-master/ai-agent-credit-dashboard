/**
 * HTTP client for the Python agent runtime (agent-runtime/).
 * The runtime is a stateless execution service: it runs a task and
 * returns the output plus the structured behavioral events; persisting
 * those events and recalculating credit happens in the API layer.
 */

export type RuntimeEvent = {
  agent_id: string
  task_id: string
  event_type: string
  success: boolean
  execution_time: number
  token_cost: number
  quality_score: number | null
  detail: Record<string, unknown>
}

export type AgentRunResult = {
  success: boolean
  output: string
  plan: string
  quality_score: number
  evaluation?: string
  token_cost: number
  execution_time: number
  events: RuntimeEvent[]
}

/**
 * Normalize AGENT_RUNTIME_URL: a bare host like
 * "my-service.up.railway.app" (no scheme) makes fetch() throw
 * "Failed to parse URL", so default a missing scheme to https and
 * trim any trailing slash.
 */
function resolveRuntimeUrl(): string {
  const raw = (process.env.AGENT_RUNTIME_URL ?? 'http://localhost:8000').trim()
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return withScheme.replace(/\/+$/, '')
}

const RUNTIME_URL = resolveRuntimeUrl()

export async function runAgentTask(input: {
  agentId: string
  taskId: string
  task: string
}): Promise<AgentRunResult> {
  const response = await fetch(`${RUNTIME_URL}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_id: input.agentId,
      task_id: input.taskId,
      task: input.task,
    }),
    // Agent runs involve several model calls; allow a generous window.
    signal: AbortSignal.timeout(180_000),
  })

  if (!response.ok) {
    throw new Error(`Agent runtime responded ${response.status}: ${await response.text()}`)
  }
  return (await response.json()) as AgentRunResult
}
