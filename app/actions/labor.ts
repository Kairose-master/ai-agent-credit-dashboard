'use server'

import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent, agentEvent, jobSpec } from '@/lib/db/schema'
import { recalculateCredit } from '@/lib/credit-engine'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'

async function requireUser() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

async function requireOwnedAgent(agentId: string, userId: string) {
  const [found] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!found || found.userId !== userId) throw new Error('Agent not found')
  return found
}

/** Jobs enriched with off-chain title/description and agent names. */
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
    return {
      ...j,
      title: spec?.title ?? 'Untitled job',
      description: spec?.description ?? null,
      requesterName: label(j.requester),
      workerName: label(j.worker),
      mine: byAddress.has(j.requester.toLowerCase()),
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
  bountyUsd: number
  minScore: number
}) {
  const userId = await requireUser()
  const ag = await requireOwnedAgent(input.requesterAgentId, userId)
  if (!ag.smartAccountAddress) throw new Error('Provision the requester agent first')
  if (!input.title.trim()) throw new Error('Title required')
  if (!Number.isFinite(input.bountyUsd) || input.bountyUsd <= 0) throw new Error('Bounty must be positive')

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
    requesterAgentId: input.requesterAgentId,
  })

  const { postJob } = await import('@/lib/onchain/labor')
  const txHash = await postJob(input.requesterAgentId, input.bountyUsd, Math.round(input.minScore), specHash)

  revalidatePath('/jobs')
  return { txHash }
}

export async function acceptJobAction(workerAgentId: string, jobId: number) {
  const userId = await requireUser()
  const ag = await requireOwnedAgent(workerAgentId, userId)
  if (!ag.smartAccountAddress) throw new Error('Provision the worker agent first')

  const { acceptJob } = await import('@/lib/onchain/labor')
  const txHash = await acceptJob(workerAgentId, jobId)
  revalidatePath('/jobs')
  return { txHash }
}

export async function submitWorkAction(workerAgentId: string, jobId: number, resultText: string) {
  const userId = await requireUser()
  await requireOwnedAgent(workerAgentId, userId)

  const { keccak256, toHex } = await import('viem')
  const resultHash = keccak256(toHex(resultText || 'delivered'))

  const { submitWork } = await import('@/lib/onchain/labor')
  const txHash = await submitWork(workerAgentId, jobId, resultHash)
  revalidatePath('/jobs')
  return { txHash }
}

/**
 * Approve delivered work: release the escrow on-chain, then record a
 * JOB_COMPLETED reputation event for the worker and recalculate its credit —
 * closing the loop from paid labor back into creditworthiness.
 */
export async function approveJobAction(requesterAgentId: string, jobId: number) {
  const userId = await requireUser()
  await requireOwnedAgent(requesterAgentId, userId)

  const { readJobs } = await import('@/lib/onchain/labor')
  const jobs = await readJobs()
  const job = jobs.find((j) => j.id === jobId)
  if (!job) throw new Error('Job not found on-chain')

  const { approveJob } = await import('@/lib/onchain/labor')
  const txHash = await approveJob(requesterAgentId, jobId)

  // Map the worker address back to one of our agents to credit its reputation.
  const [workerAgent] = await db
    .select()
    .from(agent)
    .where(eq(agent.smartAccountAddress, job.worker))

  if (workerAgent) {
    await db.insert(agentEvent).values({
      id: nanoid(),
      agentId: workerAgent.id,
      taskId: `job-${jobId}`,
      eventType: 'JOB_COMPLETED',
      success: true,
      executionTime: 0,
      tokenCost: 0,
      qualityScore: '1.000',
      detail: { jobId, bounty: job.bounty, txHash, onchain: true },
    })
    await recalculateCredit(workerAgent.id)
  }

  revalidatePath('/jobs')
  return { txHash }
}
