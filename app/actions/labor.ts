'use server'

import { headers } from 'next/headers'
import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent, agentEvent, agentTask, jobSpec } from '@/lib/db/schema'
import { recalculateCredit } from '@/lib/credit-engine'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'
import { asActionError } from '@/lib/action-error'
import { logPlatformEvent } from '@/lib/platform-feed'
import { runAgentTask } from '@/lib/agent-tasks'

async function requireUser() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

/** Dispute review is restricted to ADMIN_EMAIL — an independent party, not
 *  the job's requester or worker. */
async function requireAdmin() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail || session.user.email !== adminEmail) throw new Error('Admin access required')
  return session.user.id
}

async function requireOwnedAgent(agentId: string, userId: string) {
  const [found] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!found || found.userId !== userId) throw new Error('Agent not found')
  return found
}

async function callbackUrl() {
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host')
  return `${proto}://${host}/api/runtime/callback`
}

/** Jobs enriched with off-chain title/description/criteria, agent names, and
 *  (once submitted) the worker agent's real output. */
export async function getJobs() {
  const userId = await requireUser()
  const { isLaborMarketConfigured } = await import('@/lib/onchain/config')
  if (!isLaborMarketConfigured()) {
    return { configured: false, jobs: [], myAgents: [] as { id: string; name: string; provisioned: boolean }[] }
  }

  const { readJobs } = await import('@/lib/onchain/labor')
  const onchainJobs = await readJobs().catch(() => [])

  const specs = await db.select().from(jobSpec)
  const specByHash = new Map(specs.map((s) => [s.specHash, s]))

  const taskIds = specs.map((s) => s.agentTaskId).filter((id): id is string => Boolean(id))
  const tasks = taskIds.length > 0 ? await db.select().from(agentTask) : []
  const taskById = new Map(tasks.map((t) => [t.id, t]))

  const agents = await db.select().from(agent).where(eq(agent.userId, userId))
  const byAddress = new Map(
    agents
      .filter((a) => a.smartAccountAddress)
      .map((a) => [a.smartAccountAddress!.toLowerCase(), a]),
  )
  const label = (addr: string) => {
    if (!addr || /^0x0+$/.test(addr)) return null
    const a = byAddress.get(addr.toLowerCase())
    return a ? a.name : `${addr.slice(0, 6)}…${addr.slice(-4)}`
  }

  const jobs = onchainJobs.map((j) => {
    const spec = specByHash.get(j.specHash)
    const task = spec?.agentTaskId ? taskById.get(spec.agentTaskId) : undefined
    return {
      ...j,
      title: spec?.title ?? 'Untitled job',
      description: spec?.description ?? null,
      acceptanceCriteria: spec?.acceptanceCriteria ?? null,
      requesterName: label(j.requester),
      workerName: label(j.worker),
      mine: byAddress.has(j.requester.toLowerCase()),
      workerRunStatus: task?.status ?? null, // running | processing | completed | failed
      output: task?.status === 'completed' ? task.output : null,
      disputeNote: spec?.disputeNote ?? null,
    }
  })

  return {
    configured: true,
    jobs,
    myAgents: agents.map((a) => ({ id: a.id, name: a.name, provisioned: Boolean(a.smartAccountAddress) })),
  }
}

/** Post a job: store the spec off-chain, escrow the bounty on-chain. */
export async function postJobAction(input: {
  requesterAgentId: string
  title: string
  description: string
  acceptanceCriteria: string
  bountyUsd: number
  minScore: number
}) {
  const userId = await requireUser()
  const ag = await requireOwnedAgent(input.requesterAgentId, userId)
  if (!ag.smartAccountAddress) throw new Error('Provision the requester agent first')
  if (!input.title.trim()) throw new Error('Title required')
  if (input.acceptanceCriteria.trim().length < 10) {
    throw new Error('Acceptance criteria must be specific enough to grade (10+ characters)')
  }
  if (!Number.isFinite(input.bountyUsd) || input.bountyUsd <= 0) throw new Error('Bounty must be positive')

  try {
    const { keccak256, toHex } = await import('viem')
    const payload = JSON.stringify({
      title: input.title,
      description: input.description,
      agent: input.requesterAgentId,
      nonce: nanoid(),
    })
    const specHash = keccak256(toHex(payload))

    await db.insert(jobSpec).values({
      specHash,
      title: input.title,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria,
      requesterAgentId: input.requesterAgentId,
    })

    const { postJob } = await import('@/lib/onchain/labor')
    const txHash = await postJob(input.requesterAgentId, input.bountyUsd, Math.round(input.minScore), specHash)

    await logPlatformEvent('JOB_POSTED', `${ag.name} posted "${input.title}" — $${input.bountyUsd.toLocaleString()} bounty`)
    revalidatePath('/jobs')
    return { txHash }
  } catch (error) {
    throw asActionError(error, 'postJobAction')
  }
}

/**
 * Accept a job AND actually do it: the worker agent's real runtime (platform
 * Claude runtime or the owner's BYO webhook) is dispatched with the job's
 * title/description/acceptance criteria as its task. The real output is
 * submitted on-chain automatically when the run completes (see
 * settleLaborMarketJob in /api/runtime/callback) — no placeholder text.
 */
export async function acceptJobAction(workerAgentId: string, jobId: number) {
  const userId = await requireUser()
  const worker = await requireOwnedAgent(workerAgentId, userId)
  if (!worker.smartAccountAddress) throw new Error('Provision the worker agent first')

  try {
    const { acceptJob, readJobs } = await import('@/lib/onchain/labor')
    const txHash = await acceptJob(workerAgentId, jobId)

    const jobs = await readJobs()
    const job = jobs.find((j) => j.id === jobId)
    if (job) {
      const [spec] = await db.select().from(jobSpec).where(eq(jobSpec.specHash, job.specHash))
      if (spec) {
        const taskPrompt = [
          spec.title,
          spec.description,
          spec.acceptanceCriteria ? `Acceptance criteria (what "done" means):\n${spec.acceptanceCriteria}` : '',
        ]
          .filter(Boolean)
          .join('\n\n')

        try {
          const { taskId } = await runAgentTask({
            agent: worker,
            task: taskPrompt,
            callbackUrl: await callbackUrl(),
          })
          await db
            .update(jobSpec)
            .set({ workerAgentId, onchainJobId: jobId, agentTaskId: taskId })
            .where(eq(jobSpec.specHash, job.specHash))
        } catch (dispatchError) {
          // The on-chain accept already succeeded and can't be undone here —
          // surface the dispatch failure without pretending accept failed.
          console.error('[acceptJobAction] accepted on-chain but failed to start the real run:', dispatchError)
        }
      }
    }

    revalidatePath('/jobs')
    return { txHash }
  } catch (error) {
    throw asActionError(error, 'acceptJobAction')
  }
}

/**
 * Approve delivered work: release the escrow on-chain, then record a
 * JOB_COMPLETED reputation event for the worker and recalculate its credit —
 * closing the loop from paid labor back into creditworthiness.
 */
export async function approveJobAction(requesterAgentId: string, jobId: number) {
  const userId = await requireUser()
  await requireOwnedAgent(requesterAgentId, userId)

  try {
    const { readJobs, approveJob } = await import('@/lib/onchain/labor')
    const jobs = await readJobs()
    const job = jobs.find((j) => j.id === jobId)
    if (!job) throw new Error('Job not found on-chain')

    const txHash = await approveJob(requesterAgentId, jobId)
    await creditWorkerForJob(job.worker, jobId, job.bounty, txHash)

    revalidatePath('/jobs')
    return { txHash }
  } catch (error) {
    throw asActionError(error, 'approveJobAction')
  }
}

/** Requester disputes a submission instead of approving it — locks the
 *  escrow until an independent admin reviews and resolves it. */
export async function raiseDisputeAction(requesterAgentId: string, jobId: number, note: string) {
  const userId = await requireUser()
  await requireOwnedAgent(requesterAgentId, userId)
  if (!note.trim()) throw new Error('Explain what is wrong with the submission')

  try {
    const { raiseDispute, readJobs } = await import('@/lib/onchain/labor')
    const txHash = await raiseDispute(requesterAgentId, jobId)

    const jobs = await readJobs()
    const job = jobs.find((j) => j.id === jobId)
    if (job) {
      await db.update(jobSpec).set({ disputeNote: note.trim() }).where(eq(jobSpec.specHash, job.specHash))
    }

    await logPlatformEvent('JOB_DISPUTED', `Job #${jobId} disputed — awaiting independent review`)
    revalidatePath('/jobs')
    return { txHash }
  } catch (error) {
    throw asActionError(error, 'raiseDisputeAction')
  }
}

/** Admin-only: every Disputed job, with the original requirements and the
 *  worker's actual submitted output side by side. */
export async function getDisputedJobs() {
  await requireAdmin()

  const { readJobs } = await import('@/lib/onchain/labor')
  const jobs = await readJobs()
  const disputed = jobs.filter((j) => j.status === 'Disputed')

  const specs = await db.select().from(jobSpec)
  const specByHash = new Map(specs.map((s) => [s.specHash, s]))
  const taskIds = specs.map((s) => s.agentTaskId).filter((id): id is string => Boolean(id))
  const tasks = taskIds.length > 0 ? await db.select().from(agentTask) : []
  const taskById = new Map(tasks.map((t) => [t.id, t]))

  return disputed.map((j) => {
    const spec = specByHash.get(j.specHash)
    const task = spec?.agentTaskId ? taskById.get(spec.agentTaskId) : undefined
    return {
      id: j.id,
      title: spec?.title ?? 'Untitled job',
      description: spec?.description ?? null,
      acceptanceCriteria: spec?.acceptanceCriteria ?? null,
      disputeNote: spec?.disputeNote ?? null,
      bounty: j.bounty,
      requester: j.requester,
      worker: j.worker,
      output: task?.output ?? null,
    }
  })
}

/** Admin-only: force-settle a disputed job — releaseToWorker=true pays the
 *  worker (and credits its reputation same as a normal approval); false
 *  refunds the requester. */
export async function resolveDisputeAction(jobId: number, releaseToWorker: boolean) {
  await requireAdmin()

  try {
    const { resolveDispute, readJobs } = await import('@/lib/onchain/labor')
    const txHash = await resolveDispute(jobId, releaseToWorker)

    if (releaseToWorker) {
      const jobs = await readJobs()
      const job = jobs.find((j) => j.id === jobId)
      if (job) await creditWorkerForJob(job.worker, jobId, job.bounty, txHash)
    }

    await logPlatformEvent(
      'JOB_DISPUTE_RESOLVED',
      `Job #${jobId} dispute resolved — ${releaseToWorker ? 'paid to worker' : 'refunded to requester'}`,
    )
    revalidatePath('/jobs')
    return { txHash }
  } catch (error) {
    throw asActionError(error, 'resolveDisputeAction')
  }
}

/** Shared by approveJobAction and a worker-favoring dispute resolution: map
 *  the worker's on-chain address back to our agent row, record the
 *  reputation event, and recalculate credit. */
async function creditWorkerForJob(workerAddress: string, jobId: number, bounty: number, txHash: string) {
  const [workerAgent] = await db.select().from(agent).where(eq(agent.smartAccountAddress, workerAddress))
  if (!workerAgent) return

  await db.insert(agentEvent).values({
    id: nanoid(),
    agentId: workerAgent.id,
    taskId: `job-${jobId}`,
    eventType: 'JOB_COMPLETED',
    success: true,
    executionTime: 0,
    tokenCost: 0,
    qualityScore: '1.000',
    detail: { jobId, bounty, txHash, onchain: true },
  })
  await recalculateCredit(workerAgent.id)
  await logPlatformEvent('JOB_COMPLETED', `${workerAgent.name} completed job #${jobId} — $${bounty.toLocaleString()}`)
}
