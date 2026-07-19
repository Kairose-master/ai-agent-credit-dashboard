/**
 * Delegation ("하청") — the orchestrator core: one big task in, real
 * escrowed Labor Market jobs out, results verified and re-assembled.
 *
 *   plan     — LLM decomposes the task into 2-5 subtasks within budget
 *   post     — each subtask becomes a REAL on-chain job escrowed from the
 *              prime agent's wallet (same postJob path the dashboard uses)
 *   tick     — opportunistic sweep (called from the delegation read path,
 *              the same no-cron pattern as tickCloudAutoMineAgents):
 *              LLM-verifies Submitted work → approves on pass; snapshots
 *              outputs; assembles the final deliverable when every
 *              subtask reaches a terminal state
 *
 * Authorization model (the auto-approve lesson, applied from day one):
 * every fund movement here is bounded by consent the OWNER gave explicitly
 * at creation time — the budget field caps total escrow, and autoVerify is
 * the standing consent the verifier checks before releasing escrow on a
 * pass. The prime agent never spends beyond either.
 */
import { db } from '@/lib/db'
import { agent, delegation, jobSpec, agentTask } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import Anthropic from '@anthropic-ai/sdk'
import { resolveUserAnthropicKey } from '@/lib/user-keys'
import { logPlatformEvent } from '@/lib/platform-feed'

export const MAX_SUBTASKS = 5
export const MIN_SUBTASK_BOUNTY_USD = 1

const PLANNER_MODEL = 'claude-opus-4-8'

export interface DelegationSubtask {
  title: string
  description: string
  acceptanceCriteria: string
  bountyUsd: number
  /** Optional Python asserts — when present the subtask flows through the
   *  existing mechanical grading path instead of LLM review. */
  testCode?: string | null
  specHash?: string
  onchainJobId?: number
  /** Snapshot of the worker's delivered output once the job completes. */
  output?: string | null
  /** Terminal failure marker (refunded lineage, verification rejection…). */
  failed?: boolean
  failReason?: string
}

/** Live view derived at read time — never persisted. */
export interface SubtaskView extends DelegationSubtask {
  jobStatus: string | null
  workerLabel: string | null
}

async function anthropicClient(userId: string): Promise<Anthropic> {
  const byok = await resolveUserAnthropicKey(userId)
  const key = byok ?? process.env.ANTHROPIC_API_KEY
  if (!key) {
    throw new Error('Planning needs an Anthropic API key — add yours in Settings (BYOK), or the platform must configure one')
  }
  return new Anthropic({ apiKey: key })
}

const PLANNER_SYSTEM = `You decompose a client's task into subcontractable units for an AI-agent labor market. Each subtask is done independently by a different worker agent (an LLM with no shared context), so every subtask must be fully self-contained: include everything the worker needs in the description, never reference "the other subtask" or shared state.

Rules:
- 2 to ${MAX_SUBTASKS} subtasks, only as many as genuinely parallelizable — do NOT pad.
- acceptanceCriteria must be concrete enough that an independent reviewer can judge pass/fail from the criteria and the output text alone.
- Split the given budget across subtasks by effort; every bounty ≥ $${MIN_SUBTASK_BOUNTY_USD}; the SUM MUST NOT EXCEED the budget.
- If (and only if) a subtask is "write a single Python function" shaped, include testCode: plain Python asserts calling that function. Otherwise omit testCode.
- Output ONLY a JSON array: [{"title", "description", "acceptanceCriteria", "bountyUsd", "testCode"?}] — no commentary, no code fences.`

/** LLM-decompose `task` into subtasks. Pure planning — nothing is posted
 *  or escrowed here; the owner reviews the plan before confirming. */
export async function planDelegation(userId: string, task: string, budgetUsd: number): Promise<DelegationSubtask[]> {
  const client = await anthropicClient(userId)
  const stream = client.messages.stream({
    model: PLANNER_MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system: PLANNER_SYSTEM,
    messages: [{ role: 'user', content: `Budget: $${budgetUsd} total.\n\nClient task:\n${task}` }],
  })
  const message = await stream.finalMessage()
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .replace(/^```(?:json)?\s*|\s*```$/g, '')

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Planner returned unparseable output — try again')
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_SUBTASKS) {
    throw new Error(`Planner must produce 1-${MAX_SUBTASKS} subtasks`)
  }

  const subtasks: DelegationSubtask[] = parsed.map((raw: any, i: number) => {
    const title = String(raw?.title ?? '').trim()
    const description = String(raw?.description ?? '').trim()
    const acceptanceCriteria = String(raw?.acceptanceCriteria ?? '').trim()
    const bountyUsd = Number(raw?.bountyUsd)
    if (!title || !description || acceptanceCriteria.length < 10) {
      throw new Error(`Planner subtask ${i + 1} is missing title/description/criteria`)
    }
    if (!Number.isFinite(bountyUsd) || bountyUsd < MIN_SUBTASK_BOUNTY_USD) {
      throw new Error(`Planner subtask ${i + 1} has an invalid bounty`)
    }
    return {
      title,
      description,
      acceptanceCriteria,
      bountyUsd: Math.round(bountyUsd * 100) / 100,
      testCode: typeof raw?.testCode === 'string' && raw.testCode.trim() ? raw.testCode.trim() : null,
    }
  })

  const total = subtasks.reduce((s, x) => s + x.bountyUsd, 0)
  if (total > budgetUsd + 0.01) {
    throw new Error(`Planner exceeded the budget ($${total.toFixed(2)} > $${budgetUsd}) — try again`)
  }
  return subtasks
}

/** Post every planned subtask as a real escrowed job from the prime
 *  agent's wallet. Mutates and returns the subtask list with
 *  specHash/onchainJobId filled in. Budget was validated at plan time and
 *  is enforced here again (defense in depth — the plan jsonb could have
 *  been tampered with between plan and confirm). */
export async function postDelegationJobs(
  primeAgentId: string,
  budgetUsd: number,
  subtasks: DelegationSubtask[],
): Promise<DelegationSubtask[]> {
  const total = subtasks.reduce((s, x) => s + x.bountyUsd, 0)
  if (total > budgetUsd + 0.01) throw new Error('Subtask bounties exceed the approved budget')

  const { keccak256, toHex } = await import('viem')
  const { postJob, readJobs } = await import('@/lib/onchain/labor')

  const [prime] = await db.select().from(agent).where(eq(agent.id, primeAgentId))
  if (!prime?.smartAccountAddress) throw new Error('Prime agent has no provisioned wallet')

  // Check the escrow is actually affordable BEFORE the first on-chain call —
  // a raw "USDC: balance" revert mid-posting is undiagnosable for users.
  const remaining = subtasks.filter((st) => st.onchainJobId === undefined)
  const needed = remaining.reduce((s, x) => s + x.bountyUsd, 0)
  try {
    const { usdcBalanceOf } = await import('@/lib/onchain/treasury')
    const balance = await usdcBalanceOf(prime.smartAccountAddress as `0x${string}`)
    if (balance < needed) {
      throw new Error(
        `${prime.name}'s wallet holds $${balance.toFixed(2)} but posting the remaining subtasks escrows $${needed.toFixed(2)} — mint test USDC on the agent's Treasury card first`,
      )
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('mint test USDC')) throw error
    // Balance read itself failed (RPC hiccup) — let posting proceed and
    // surface the on-chain error if there genuinely isn't enough.
    console.error('[delegation] balance pre-check failed (continuing):', error)
  }

  for (let i = 0; i < subtasks.length; i++) {
    const st = subtasks[i]
    if (st.onchainJobId !== undefined) continue // already posted (confirm retried)

    const specHash = keccak256(
      toHex(JSON.stringify({ title: st.title, description: st.description, agent: primeAgentId, nonce: nanoid() })),
    )
    await db.insert(jobSpec).values({
      specHash,
      title: st.title,
      description: st.description,
      acceptanceCriteria: st.acceptanceCriteria,
      requesterAgentId: primeAgentId,
      testCode: st.testCode ?? null,
      // Mechanical grading (testCode) may auto-release under the existing
      // bounded path; LLM-verified subtasks release via the delegation
      // verifier below, so the job itself stays manual-approve.
      autoApprove: Boolean(st.testCode),
    })

    // Bundler rate limits back-to-back userops (free tier) — space them.
    if (i > 0) await new Promise((r) => setTimeout(r, 2000))
    await postJob(primeAgentId, st.bountyUsd, 0, specHash)

    // postJob doesn't return the job id — resolve it via the specHash.
    const jobs = await readJobs()
    const posted = jobs.find((j) => j.specHash === specHash)
    st.specHash = specHash
    st.onchainJobId = posted?.id

    await logPlatformEvent('JOB_POSTED', `${prime.name} subcontracted "${st.title}" — $${st.bountyUsd} bounty (delegation)`)
  }
  return subtasks
}

const VERIFIER_SYSTEM = `You are an independent reviewer for an AI-agent labor market. Judge whether the submitted output satisfies the acceptance criteria. Be strict but fair: the criteria are the contract — do not invent extra requirements, and do not excuse clear failures. Output ONLY a JSON object {"pass": boolean, "reason": "one sentence"}.`

async function verifySubmission(
  client: Anthropic,
  st: DelegationSubtask,
  output: string,
): Promise<{ pass: boolean; reason: string }> {
  const stream = client.messages.stream({
    model: PLANNER_MODEL,
    max_tokens: 2000,
    thinking: { type: 'adaptive' },
    system: VERIFIER_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Subtask: ${st.title}\n\nDescription:\n${st.description}\n\nAcceptance criteria:\n${st.acceptanceCriteria}\n\nSubmitted output:\n${output.slice(0, 20_000)}`,
      },
    ],
  })
  const message = await stream.finalMessage()
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .replace(/^```(?:json)?\s*|\s*```$/g, '')
  try {
    const parsed = JSON.parse(text)
    return { pass: Boolean(parsed?.pass), reason: String(parsed?.reason ?? '') }
  } catch {
    // Unparseable verdict = no verdict: leave the job Submitted for a
    // human rather than guessing either way with escrowed money.
    return { pass: false, reason: 'verifier returned no parseable verdict — left for manual review' }
  }
}

/** Deterministic final assembly — never depends on an LLM being available,
 *  so a finished delegation can always deliver. */
function assembleFinalOutput(task: string, subtasks: DelegationSubtask[]): string {
  const parts = [`# Delegated task\n\n${task}\n`]
  subtasks.forEach((st, i) => {
    parts.push(`\n---\n\n## Part ${i + 1}: ${st.title}\n`)
    if (st.failed) {
      parts.push(`_This part did not complete (${st.failReason ?? 'failed'})._\n`)
    } else {
      parts.push(`${st.output ?? '(no output recorded)'}\n`)
    }
  })
  return parts.join('')
}

/**
 * One opportunistic tick for a single delegation: derive each subtask's
 * live job state, LLM-verify Submitted work (approve on pass, when the
 * owner opted in), snapshot outputs, and finalize when everything is
 * terminal. Called from the owner's own read path — same no-cron pattern
 * as reapStuckTasks/tickCloudAutoMineAgents.
 */
export async function tickDelegation(
  row: typeof delegation.$inferSelect,
  jobsShared?: Awaited<ReturnType<typeof import('@/lib/onchain/labor').readJobs>>,
): Promise<void> {
  if (row.status !== 'posted') return
  const subtasks = row.subtasks as DelegationSubtask[]

  const { readJobs, approveJob } = await import('@/lib/onchain/labor')
  const jobs = jobsShared ?? (await readJobs().catch(() => []))
  if (jobs.length === 0) return

  const specs = await db.select().from(jobSpec)
  const specByHash = new Map(specs.map((s) => [s.specHash, s]))

  let client: Anthropic | null = null
  let changed = false

  for (const st of subtasks) {
    if (st.failed || st.output != null || st.onchainJobId === undefined) continue
    const job = jobs.find((j) => j.id === st.onchainJobId)
    if (!job) continue
    const spec = st.specHash ? specByHash.get(st.specHash) : undefined

    if (job.status === 'Completed') {
      // Paid out (mechanically graded path, or our own earlier approval) —
      // snapshot the deliverable.
      const task = spec?.agentTaskId
        ? (await db.select().from(agentTask).where(eq(agentTask.id, spec.agentTaskId)))[0]
        : undefined
      st.output = task?.output ?? '(worker output unavailable)'
      changed = true
      continue
    }

    if (job.status === 'Cancelled' || job.status === 'Refunded') {
      // Refunded = the grader failed a worker's submission and the
      // auto-return path refunded + reposted the same spec as a NEW job
      // (parentSpecHash lineage, recorded at repost time). Follow the
      // lineage: retarget this subtask at the replacement and keep
      // tracking, so one bad worker doesn't dead-end the delegation.
      const successor = st.specHash
        ? specs.find((s) => s.parentSpecHash === st.specHash)
        : undefined
      const successorJob = successor ? jobs.find((j) => j.specHash === successor.specHash) : undefined
      if (successor && successorJob) {
        st.specHash = successor.specHash
        st.onchainJobId = successorJob.id
        changed = true
        continue
      }
      // No replacement on-chain (owner cancel, repost failure, or a
      // pre-lineage refund) — terminal. Escrow is back in the prime's wallet.
      st.failed = true
      st.failReason = `job ${job.status.toLowerCase()} — escrow returned`
      changed = true
      continue
    }

    if (job.status === 'Submitted' && row.autoVerify) {
      const task = spec?.agentTaskId
        ? (await db.select().from(agentTask).where(eq(agentTask.id, spec.agentTaskId)))[0]
        : undefined
      const output = task?.output
      if (!output) continue // submitted on-chain but output not yet recorded — next tick

      try {
        client = client ?? (await anthropicClient(row.userId))
        const verdict = await verifySubmission(client, st, output)
        if (verdict.pass) {
          const txHash = await approveJob(row.primeAgentId, st.onchainJobId)
          const { creditWorkerForJob } = await import('@/app/actions/labor')
          await creditWorkerForJob(job.worker, st.onchainJobId, job.bounty, txHash)
          st.output = output
          changed = true
          await logPlatformEvent(
            'JOB_AUTO_APPROVED',
            `"${st.title}" — delegation verifier passed the work, escrow released`,
          )
        }
        // On fail: leave the job Submitted for the owner to judge manually
        // (auto-disputing on an LLM verdict would spam the admin queue and
        // an LLM "fail" is weaker evidence than a failed test run).
      } catch (error) {
        console.error('[delegation] verify/approve failed:', error)
      }
    }
  }

  const allTerminal = subtasks.every((st) => st.failed || st.output != null)
  if (allTerminal) {
    await db
      .update(delegation)
      .set({
        status: 'completed',
        subtasks,
        finalOutput: assembleFinalOutput(row.task, subtasks),
        updatedAt: new Date(),
      })
      .where(eq(delegation.id, row.id))
    await logPlatformEvent('DELEGATION_COMPLETED', `Delegated task finished — ${subtasks.filter((s) => !s.failed).length}/${subtasks.length} parts delivered`)
  } else if (changed) {
    await db.update(delegation).set({ subtasks, updatedAt: new Date() }).where(eq(delegation.id, row.id))
  }
}

/** Live per-subtask view (job status + worker) for the UI. */
export async function subtaskViews(
  row: typeof delegation.$inferSelect,
  jobsShared?: Awaited<ReturnType<typeof import('@/lib/onchain/labor').readJobs>>,
): Promise<SubtaskView[]> {
  const subtasks = row.subtasks as DelegationSubtask[]
  const { readJobs } = await import('@/lib/onchain/labor')
  const jobs = jobsShared ?? (await readJobs().catch(() => []))
  return subtasks.map((st) => {
    const job = jobs.find((j) => j.id === st.onchainJobId)
    return {
      ...st,
      jobStatus: job?.status ?? null,
      workerLabel: job?.worker && !/^0x0+$/.test(job.worker) ? `${job.worker.slice(0, 6)}…${job.worker.slice(-4)}` : null,
    }
  })
}
