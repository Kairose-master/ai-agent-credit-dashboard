'use server'

/**
 * Live progress for the interactive guide: each step's "done" state is a
 * real query over the user's actual data, so the checklist checks itself
 * off as the account genuinely does things — a guide that can't drift out
 * of sync with reality, because it IS reality.
 */
import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent, agentEvent, agentTask } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { getApiKeyStatus } from '@/app/actions/settings'

export async function getGuideProgress() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')

  const agents = await db.select().from(agent).where(eq(agent.userId, session.user.id))
  const agentIds = agents.map((a) => a.id)

  const [tasks, jobEvents, keyStatus] = await Promise.all([
    agentIds.length > 0
      ? db.select({ id: agentTask.id }).from(agentTask).where(inArray(agentTask.agentId, agentIds)).limit(1)
      : Promise.resolve([]),
    agentIds.length > 0
      ? db
          .select({ id: agentEvent.id, eventType: agentEvent.eventType })
          .from(agentEvent)
          .where(inArray(agentEvent.agentId, agentIds))
      : Promise.resolve([] as { id: string; eventType: string }[]),
    getApiKeyStatus(),
  ])

  return {
    hasAgent: agents.length > 0,
    hasApiKey: keyStatus.hasKey,
    hasProvisioned: agents.some((a) => a.smartAccountAddress),
    hasRunTask: tasks.length > 0,
    hasLocalWorker: agents.some((a) => a.runtimeType === 'local' && a.lastPollAt !== null),
    hasAutoMine: agents.some((a) => a.autoMine),
    hasCompletedJob: jobEvents.some((e) => e.eventType === 'JOB_COMPLETED'),
    hasErc8004: agents.some((a) => a.erc8004Id),
  }
}
