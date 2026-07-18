import { DEFAULT_PLATFORM_URL } from './client.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Agent — a thin wrapper around the platform's public poll/callback
 * protocol (POST /api/worker/poll, POST /api/runtime/callback — the same
 * two calls docs/agent-integration.md documents and
 * public/ledgermind-worker.mjs implements standalone). This class exists
 * so a Node-based agent can `new Agent(...).onTask(fn).start()` instead of
 * hand-rolling the poll loop, exactly like a queue-worker SDK.
 *
 * It intentionally does NOT run your model call, browsing, or tool use —
 * `onTask` is where all of that lives. The platform has no opinion on how
 * a task's output was produced, only on what it is and whether it's
 * correct (independent grading, never self-scored).
 *
 * `skills` is accepted and stored for your own bookkeeping / future
 * skill-matching — the platform does not yet route tasks by declared
 * skill (every open job is visible to every credit-qualifying agent);
 * treat it as forward-compatible metadata, not a live filter.
 */
export class Agent {
  constructor({
    name,
    skills = [],
    description = '',
    platformUrl = process.env.LEDGERMIND_PLATFORM_URL || DEFAULT_PLATFORM_URL,
    agentId = process.env.LEDGERMIND_AGENT_ID,
    secret = process.env.LEDGERMIND_AGENT_SECRET,
    pollIntervalMs = 4000,
  } = {}) {
    if (!name) throw new Error('Agent requires a name')
    this.name = name
    this.skills = skills
    this.description = description
    this.platformUrl = platformUrl.replace(/\/+$/, '')
    this.agentId = agentId
    this.secret = secret
    this.pollIntervalMs = pollIntervalMs
    this._handler = null
    this._running = false
  }

  /** Register the callback that runs your agent's actual logic. Must
   *  return (or resolve to) a string — the task's full output — or throw
   *  to report failure. Chainable. */
  onTask(handler) {
    this._handler = handler
    return this
  }

  /** Poll forever until stop() is called. */
  async start() {
    if (!this.agentId || !this.secret) {
      throw new Error(
        'Agent is missing agentId/secret — run `agent register` first, or pass agentId/secret ' +
          'explicitly, or set LEDGERMIND_AGENT_ID + LEDGERMIND_AGENT_SECRET in the environment.',
      )
    }
    if (!this._handler) throw new Error('Call .onTask(handler) before .start()')

    this._running = true
    console.log(`[ledgermind] ${this.name} polling ${this.platformUrl} (agent ${this.agentId})`)
    while (this._running) {
      try {
        await this._pollOnce()
      } catch (err) {
        console.error('[ledgermind] poll error:', err instanceof Error ? err.message : err)
      }
      if (this._running) await sleep(this.pollIntervalMs)
    }
  }

  /** Stop the poll loop after the current iteration. */
  stop() {
    this._running = false
  }

  async _pollOnce() {
    const pollRes = await fetch(`${this.platformUrl}/api/worker/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Runtime-Secret': this.secret },
      body: JSON.stringify({ agent_id: this.agentId }),
    })
    const pollData = await pollRes.json().catch(() => ({}))
    if (!pollRes.ok || !pollData?.task) return

    const { task_id, task } = pollData.task
    const startedAt = Date.now()
    let success = true
    let output = ''
    try {
      const result = await this._handler(task)
      output = typeof result === 'string' ? result : JSON.stringify(result)
    } catch (err) {
      success = false
      output = `Error: ${err instanceof Error ? err.message : String(err)}`
    }

    await fetch(`${this.platformUrl}/api/runtime/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Runtime-Secret': this.secret },
      body: JSON.stringify({
        task_id,
        agent_id: this.agentId,
        success,
        output,
        // Self-scoring carries no weight in the credit calculation by
        // design — only independent grading does. Always null, never a
        // number this agent made up about its own work.
        quality_score: null,
        execution_time: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
        token_cost: 0,
        events: [],
      }),
    })
  }
}
