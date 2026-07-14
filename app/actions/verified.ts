'use server'

import { headers } from 'next/headers'
import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent, agentTask, verifiableTask } from '@/lib/db/schema'
import { desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'
import { randomBytes } from 'node:crypto'
import { generateProblem, problemPrompt, type Difficulty } from '@/lib/verifiable/problems'
import { startAgentTask } from '@/lib/agent-runtime/client'

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

export async function getVerifiedTasks() {
  const userId = await requireUser()
  const { isVerifiedEscrowConfigured } = await import('@/lib/onchain/config')

  const rows = await db
    .select()
    .from(verifiableTask)
    .where(eq(verifiableTask.userId, userId))
    .orderBy(desc(verifiableTask.createdAt))
    .limit(30)

  const agents = await db.select().from(agent).where(eq(agent.userId, userId))
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? id

  return {
    configured: isVerifiedEscrowConfigured(),
    myAgents: agents.map((a) => ({ id: a.id, name: a.name, provisioned: Boolean(a.smartAccountAddress) })),
    tasks: rows.map((r) => ({
      id: r.id,
      solver: name(r.solverAgentId),
      requester: name(r.requesterAgentId),
      difficulty: r.difficulty,
      problem: r.problem,
      bountyUsd: parseFloat(r.bountyUsd),
      status: r.status,
      submittedAnswer: r.submittedAnswer,
      // The hidden answer is only exposed once the task is settled or failed.
      answer: r.status === 'completed' || r.status === 'failed' ? r.answer : null,
      postTxHash: r.postTxHash,
      settleTxHash: r.settleTxHash,
      error: r.error,
      createdAt: r.createdAt,
    })),
  }
}

/**
 * Start a verified task end-to-end:
 *  1. generate problem + hidden answer (grader ≠ solver)
 *  2. escrow the bounty on-chain (requester's smart account)
 *  3. send ONLY the problem to the solving agent (async runtime)
 * Settlement happens in the runtime callback once the solve returns.
 */
export async function startVerifiedTask(input: {
  solverAgentId: string
  requesterAgentId: string
  difficulty: Difficulty
  bountyUsd: number
}) {
  const userId = await requireUser()
  const solver = await requireOwnedAgent(input.solverAgentId, userId)
  const requester = await requireOwnedAgent(input.requesterAgentId, userId)
  if (!solver.smartAccountAddress || !requester.smartAccountAddress) {
    throw new Error('Both agents need provisioned smart accounts')
  }
  if (solver.id === requester.id) throw new Error('Solver and requester must differ')
  if (!Number.isFinite(input.bountyUsd) || input.bountyUsd <= 0) throw new Error('Bounty must be positive')

  const { isVerifiedEscrowConfigured } = await import('@/lib/onchain/config')
  if (!isVerifiedEscrowConfigured()) throw new Error('Verified escrow not configured')

  const spec = generateProblem(input.difficulty)
  const salt = `0x${randomBytes(32).toString('hex')}` as `0x${string}`

  const id = nanoid()
  await db.insert(verifiableTask).values({
    id,
    userId,
    solverAgentId: solver.id,
    requesterAgentId: requester.id,
    difficulty: spec.difficulty,
    problem: spec.problem,
    answer: spec.answer,
    salt,
    bountyUsd: input.bountyUsd.toString(),
    status: 'posting',
  })

  // Escrow on-chain: specHash commits to the problem, answerHash to the truth.
  const { keccak256, toHex } = await import('viem')
  const { postVerifiedTask, answerHashOf } = await import('@/lib/onchain/verified')
  const { txHash, taskId: onchainId } = await postVerifiedTask(
    requester.id,
    input.bountyUsd,
    0, // minScore 0: the solver is chosen explicitly here, gating is for open markets
    keccak256(toHex(spec.problem)),
    answerHashOf(spec.answer),
  )

  // Kick the solve — the agent sees the problem only, never the answer.
  const agentTaskId = `task-${nanoid(10)}`
  await db.insert(agentTask).values({
    id: agentTaskId,
    userId,
    agentId: solver.id,
    task: spec.problem,
    status: 'running',
  })

  const { resolveUserAnthropicKey } = await import('@/lib/user-keys')
  const apiKey = await resolveUserAnthropicKey(userId)

  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host')
  await startAgentTask({
    agentId: solver.id,
    taskId: agentTaskId,
    task: problemPrompt(spec.problem),
    callbackUrl: `${proto}://${host}/api/runtime/callback`,
    apiKey,
  })

  await db
    .update(verifiableTask)
    .set({ onchainId, agentTaskId, postTxHash: txHash, status: 'solving', updatedAt: new Date() })
    .where(eq(verifiableTask.id, id))

  revalidatePath('/verify')
  return { id, onchainId, postTxHash: txHash }
}

/** Reclaim escrow from a task whose solve failed (on-chain task still Open). */
export async function reclaimVerifiedTask(id: string) {
  const userId = await requireUser()
  const [row] = await db.select().from(verifiableTask).where(eq(verifiableTask.id, id))
  if (!row || row.userId !== userId) throw new Error('Task not found')
  if (row.status !== 'failed' || !row.onchainId) throw new Error('Nothing to reclaim')

  const { cancelVerifiedTask } = await import('@/lib/onchain/verified')
  const txHash = await cancelVerifiedTask(row.requesterAgentId, row.onchainId)

  await db
    .update(verifiableTask)
    .set({ status: 'error', error: `escrow reclaimed (${txHash.slice(0, 10)}…)`, updatedAt: new Date() })
    .where(eq(verifiableTask.id, id))

  revalidatePath('/verify')
  return { txHash }
}
