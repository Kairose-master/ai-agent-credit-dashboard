'use server'

/**
 * Guest mode: a read-only, no-login snapshot of the platform's real,
 * live data — for visitors deciding whether to sign up. Every number here
 * is a genuine query against the same tables/on-chain reads the logged-in
 * dashboard uses (see Claude.md's "No fabricated numbers, ever"); nothing
 * is seeded or hardcoded for show. Deliberately narrower than the logged-in
 * views: no per-user "mine" labeling (there's no user), no mutations.
 */
import { db } from '@/lib/db'
import { agent, agentTemplate, platformEvent, jobSpec, agentTask } from '@/lib/db/schema'
import { eq, desc, sql } from 'drizzle-orm'

function truncate(addr: string | null | undefined): string | null {
  if (!addr || /^0x0+$/.test(addr)) return null
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Same shape as the logged-in Jobs page's cards (acceptance criteria,
 *  real output, dispute reason, attachment) minus "mine"/action buttons —
 *  guests can't act, but should be able to see the real flow at a glance. */
async function publicJobs() {
  const { isLaborMarketConfigured } = await import('@/lib/onchain/config')
  if (!isLaborMarketConfigured()) return []

  const { readJobs } = await import('@/lib/onchain/labor')
  const { reapStuckTasks } = await import('@/lib/agent-tasks')
  await reapStuckTasks()

  const onchainJobs = await readJobs().catch(() => [])
  const specs = await db.select().from(jobSpec)
  const specByHash = new Map(specs.map((s) => [s.specHash, s]))

  const taskIds = specs.map((s) => s.agentTaskId).filter((id): id is string => Boolean(id))
  const tasks = taskIds.length > 0 ? await db.select().from(agentTask) : []
  const taskById = new Map(tasks.map((t) => [t.id, t]))

  return onchainJobs
    .slice(0, 10)
    .map((j) => {
      const spec = specByHash.get(j.specHash)
      const task = spec?.agentTaskId ? taskById.get(spec.agentTaskId) : undefined
      return {
        id: j.id,
        title: spec?.title ?? 'Untitled job',
        description: spec?.description ?? null,
        acceptanceCriteria: spec?.acceptanceCriteria ?? null,
        status: j.status,
        bounty: j.bounty,
        minScore: j.minScore,
        requesterLabel: truncate(j.requester),
        workerLabel: truncate(j.worker),
        workerRunStatus: task?.status ?? null,
        output: task?.status === 'completed' ? task.output : null,
        disputeNote: spec?.disputeNote ?? null,
        attachmentUrl: spec?.attachmentUrl ?? null,
        attachmentName: spec?.attachmentName ?? null,
        testResult: spec?.testResult ?? null,
      }
    })
}

export async function getGuestOverview() {
  const [stats] = await db
    .select({
      agentCount: sql<number>`count(*)`,
      avgScore: sql<number>`avg(${agent.creditScore})`,
      totalCreditLine: sql<number>`coalesce(sum(${agent.totalCreditLine}), 0)`,
    })
    .from(agent)

  const feedRows = await db
    .select()
    .from(platformEvent)
    .orderBy(desc(platformEvent.createdAt))
    .limit(15)

  const templateRows = await db
    .select()
    .from(agentTemplate)
    .where(eq(agentTemplate.active, true))
    .orderBy(desc(agentTemplate.createdAt))
    .limit(10)

  const jobs = await publicJobs()

  return {
    stats: {
      agentCount: Number(stats?.agentCount ?? 0),
      avgScore: stats?.avgScore ? Math.round(Number(stats.avgScore)) : null,
      totalCreditLine: Number(stats?.totalCreditLine ?? 0),
    },
    feed: feedRows.map((r) => ({ id: r.id, kind: r.kind, summary: r.summary, createdAt: r.createdAt })),
    templates: templateRows.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      priceUsd: parseFloat(t.priceUsd),
    })),
    jobs,
  }
}
