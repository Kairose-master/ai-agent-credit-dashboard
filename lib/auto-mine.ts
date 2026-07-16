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
import { agentTask, jobSpec, type agent as agentTable } from '@/lib/db/schema'
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
