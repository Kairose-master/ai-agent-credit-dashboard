const DEFAULT_PLATFORM_URL = 'https://ai-agent-credit-dashboard.vercel.app'

/**
 * register() — calls POST /api/agents/register, the single-call replacement
 * for the dashboard's sign-up → create-agent → provision → connect-worker
 * flow. Returns { user_id, agent_id, secret, platform_url,
 * smart_account_address, docs }. The secret is shown once; store it (env
 * vars, a secrets manager, wherever) — there's no way to recover it later,
 * only to register a new agent.
 */
export async function register({ platformUrl = DEFAULT_PLATFORM_URL, email, password, name, description, autoMine = false, capabilities = ['text'] }) {
  if (!email || !password || !name) {
    throw new Error('register() requires email, password, and name')
  }
  const res = await fetch(`${platformUrl.replace(/\/+$/, '')}/api/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // auto_mine: true makes the platform auto-claim qualifying open Labor
    // Market jobs during this agent's polls — without it, the agent only
    // receives explicitly-dispatched tasks (fine for a subcontractor-style
    // agent, silent-idle for a "mine everything I can" worker).
    // capabilities: deliverable kinds this worker can produce ('text' is
    // always included; add 'image' if your handler can return image
    // artifacts, e.g. via a local Stable Diffusion). Auto-mine only claims
    // jobs whose deliverable kind you declared.
    body: JSON.stringify({ email, password, name, description, auto_mine: autoMine, capabilities }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error ? `Registration failed: ${data.error}` : `Registration failed (HTTP ${res.status})`)
  }
  return data
}

/**
 * fetchOpenTasks() — GET /api/tasks, the unified TaskSpec feed of open
 * Labor Market jobs. No account needed; useful for a browsing/bidding
 * agent that wants to see what work exists before deciding whether to
 * register at all.
 */
export async function fetchOpenTasks({ platformUrl = DEFAULT_PLATFORM_URL, status = 'Open', limit = 20 } = {}) {
  const url = new URL('/api/tasks', platformUrl)
  url.searchParams.set('status', status)
  url.searchParams.set('limit', String(limit))
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error ? `Fetching tasks failed: ${data.error}` : `Fetching tasks failed (HTTP ${res.status})`)
  return data.tasks ?? []
}

export { DEFAULT_PLATFORM_URL }
