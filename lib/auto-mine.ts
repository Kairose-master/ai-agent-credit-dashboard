/**
 * Auto-mine: the poll loop IS the mining loop.
 *
 * When a local worker polls for work and its queue is empty, this claims
 * the next qualifying Open job on its behalf — accept on-chain, dispatch
 * the run — so a GPU owner's pipeline is: flip Auto-mine on, leave the
 * worker running, done. No daemon exists anywhere: the worker's own 3s
 * heartbeat drives acceptance, which degrades gracefully to "nothing
 * happens" when the worker is offline (exactly right — a job should never
 * be claimed by a machine that isn't there to do it).
 *
 * Rules per tick: only when the agent is fully idle (no queued/running/
 * processing task); one job per tick; only jobs whose minScore the agent
 * clears (avoids a guaranteed on-chain revert), that it didn't post
 * itself, and whose test lineage it hasn't already failed. A crash window
 * between accept and dispatch is self-healed on the next tick by
 * re-dispatching accepted-but-taskless jobs.
 */
import { db } from '@/lib/db'
import { agent, agentTask, jobSpec, type agent as agentTable } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { acceptAndDispatchJob, dispatchAcceptedJob, isClaimedByOther } from '@/lib/labor-dispatch'
import { logPlatformEvent } from '@/lib/platform-feed'

type AgentRow = typeof agentTable.$inferSelect

export async function autoMineTick(agent: AgentRow, callbackUrl: string): Promise<boolean> {
  if (!agent.autoMine || !agent.smartAccountAddress) return false

  const busy = await db
    .select({ id: agentTask.id })
    .from(agentTask)
    .where(and(eq(agentTask.agentId, agent.id), inArray(agentTask.status, ['queued', 'running', 'processing'])))
    .limit(1)
  if (busy.length > 0) return false

  const { isLaborMarketConfigured } = await import('@/lib/onchain/config')
  if (!isLaborMarketConfigured()) return false

  const { readJobs } = await import('@/lib/onchain/labor')
  const jobs = await readJobs().catch(() => [])
  const myAddress = agent.smartAccountAddress.toLowerCase()

  // Self-heal first: a job this agent accepted whose dispatch never
  // happened (e.g. a timeout between accept and runAgentTask).
  for (const j of jobs) {
    if (j.status !== 'Accepted' || j.worker.toLowerCase() !== myAddress) continue
    const [spec] = await db.select().from(jobSpec).where(eq(jobSpec.specHash, j.specHash))
    if (spec && !spec.agentTaskId) {
      await dispatchAcceptedJob(agent, j.id, spec, callbackUrl)
      return true
    }
  }

  const score = Math.round(parseFloat(agent.creditScore))
  for (const j of jobs) {
    if (j.status !== 'Open') continue
    if (j.minScore > score) continue
    if (j.requester.toLowerCase() === myAddress) continue // no self-dealing

    const [spec] = await db.select().from(jobSpec).where(eq(jobSpec.specHash, j.specHash))
    if (!spec) continue // no off-chain spec = nothing to actually do
    if (spec.failedWorkerIds?.includes(agent.id)) continue
    if (isClaimedByOther(spec, agent.id)) continue // another rig has this work unit

    try {
      await acceptAndDispatchJob(agent, j.id, callbackUrl)
      await logPlatformEvent(
        'JOB_AUTO_ACCEPTED',
        `${agent.name} auto-claimed job #${j.id} "${spec.title}" (auto-mine)`,
      )
      return true
    } catch (error) {
      // Lost the race (someone else accepted) or a transient revert —
      // try the next job rather than giving up the tick.
      console.error(`[auto-mine] claim of job ${j.id} failed:`, error)
    }
  }

  return false
}

// Cheap in-memory cooldown, per serverless instance — good enough for a
// best-effort sweep (over-ticking across cold instances is harmless;
// autoMineTick() is self-limiting via its own busy/status checks).
let lastCloudSweepAt = 0
const CLOUD_SWEEP_COOLDOWN_MS = 15_000

/**
 * A local worker's own 3s poll heartbeat IS its mining loop (see the
 * module doc comment) — but a 'cloud' agent never polls at all; the
 * platform dispatches TO it, not the other way around (see
 * dispatchToCloudApi in lib/agent-tasks.ts). Nothing would ever call
 * autoMineTick() for one on its own. This is the substitute: swept
 * opportunistically from the same already-frequent read paths that already
 * call reapStuckTasks() (the Jobs page, the guest page), throttled so an
 * on-chain read doesn't run on every single request. Best-effort, same
 * spirit as everything else here — a quiet period with zero site traffic
 * means no sweep, the same way an offline local worker means no claims.
 */
export async function tickCloudAutoMineAgents(callbackUrl: string): Promise<void> {
  const now = Date.now()
  if (now - lastCloudSweepAt < CLOUD_SWEEP_COOLDOWN_MS) return
  lastCloudSweepAt = now

  const { isLaborMarketConfigured } = await import('@/lib/onchain/config')
  if (!isLaborMarketConfigured()) return

  const candidates = await db
    .select()
    .from(agent)
    .where(and(eq(agent.runtimeType, 'cloud'), eq(agent.autoMine, true)))
  for (const a of candidates) {
    await autoMineTick(a, callbackUrl).catch((error) => {
      console.error(`[auto-mine] cloud sweep tick failed for ${a.id}:`, error)
    })
  }
}
