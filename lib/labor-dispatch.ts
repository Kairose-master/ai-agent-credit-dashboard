/**
 * Shared accept-and-dispatch for Labor Market jobs — one code path used by
 * BOTH the human-clicked accept (acceptJobAction) and auto-mine's
 * poll-driven accept, so prompt construction / failed-worker blocking /
 * dispatch bookkeeping can't drift between them.
 */
import { db } from '@/lib/db'
import { jobSpec, type agent as agentTable } from '@/lib/db/schema'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { runAgentTask } from '@/lib/agent-tasks'

type AgentRow = typeof agentTable.$inferSelect
type SpecRow = typeof jobSpec.$inferSelect

/** How long an off-chain claim holds before it's considered abandoned.
 *  Long enough to cover an on-chain accept + dispatch (~30–60s on
 *  Sepolia); short enough that a crashed claimer releases the job fast. */
export const JOB_CLAIM_TTL_MS = 90_000

/** Mining-pool-style work-unit claim: atomically take the spec for this
 *  worker BEFORE touching the chain. Exactly one concurrent claimer wins
 *  (single UPDATE ... WHERE unclaimed-or-stale RETURNING); everyone else
 *  learns in milliseconds instead of racing to an on-chain revert. */
export async function claimJobSpec(specHash: string, agentId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - JOB_CLAIM_TTL_MS)
  const won = await db
    .update(jobSpec)
    .set({ claimedByAgentId: agentId, claimedAt: new Date() })
    .where(
      and(
        eq(jobSpec.specHash, specHash),
        or(
          isNull(jobSpec.claimedByAgentId),
          eq(jobSpec.claimedByAgentId, agentId), // re-entrant for the same worker
          lt(jobSpec.claimedAt, staleBefore),
        ),
      ),
    )
    .returning({ specHash: jobSpec.specHash })
  return won.length > 0
}

async function releaseJobClaim(specHash: string, agentId: string): Promise<void> {
  await db
    .update(jobSpec)
    .set({ claimedByAgentId: null, claimedAt: null })
    .where(and(eq(jobSpec.specHash, specHash), eq(jobSpec.claimedByAgentId, agentId)))
}

/** The Labor Market contract reverts SelfWork() when an agent accepts a
 *  job it posted itself — catch it API-side with an actionable message
 *  instead of burning gas on a guaranteed revert. (Delegation subtasks
 *  are posted by the prime agent, so claiming one with that same prime
 *  is the common way to hit this.) */
export function assertNotSelfClaim(worker: AgentRow, requesterAddress: string | undefined): void {
  if (
    requesterAddress &&
    worker.smartAccountAddress &&
    requesterAddress.toLowerCase() === worker.smartAccountAddress.toLowerCase()
  ) {
    throw new Error(
      `${worker.name} posted this job itself (it's the escrowing requester) — an agent can't claim its own job. Claim it with a different agent on the account, or leave it for the market.`,
    )
  }
}

/** True when someone else holds a live (non-stale) claim on this spec. */
export function isClaimedByOther(spec: SpecRow, agentId: string): boolean {
  return Boolean(
    spec.claimedByAgentId &&
      spec.claimedByAgentId !== agentId &&
      spec.claimedAt &&
      Date.now() - spec.claimedAt.getTime() < JOB_CLAIM_TTL_MS,
  )
}

export function buildJobTaskPrompt(spec: SpecRow): string {
  return [
    spec.title,
    spec.description,
    spec.acceptanceCriteria ? `Acceptance criteria (what "done" means):\n${spec.acceptanceCriteria}` : '',
    spec.attachmentUrl
      ? `Source material for this task is attached at: ${spec.attachmentUrl}` +
        (spec.attachmentName ? ` (original filename: ${spec.attachmentName})` : '') +
        `\nUse the fetch_url tool to read it before doing the work — it is not summarized here.`
      : '',
    spec.testCode
      ? `This job is AUTO-GRADED. Your answer MUST include your complete Python solution in a ` +
        '```python fenced code block — the LAST such block in your answer is what gets graded, ' +
        `by running it against the acceptance tests below (plain asserts appended after your code). ` +
        `CRITICAL: that code block must contain ONLY the solution — function definitions plus any ` +
        `imports they need. NO example usage, NO self-test calls, NO top-level prints or demo data: ` +
        `the grader appends the tests itself, and any crash in extra top-level code fails the job ` +
        `even if your functions are correct. ` +
        `Use the run_python tool to run your code against these exact tests BEFORE answering, and ` +
        `only submit once they pass.\n\nAcceptance tests:\n${spec.testCode}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Start the worker's real run for an already-accepted job and link the
 *  task to the spec. Split out so a crash between accept and dispatch can
 *  be healed later (auto-mine re-dispatches accepted-but-taskless jobs). */
export async function dispatchAcceptedJob(
  worker: AgentRow,
  jobId: number,
  spec: SpecRow,
  callbackUrl: string,
): Promise<void> {
  const { taskId } = await runAgentTask({
    agent: worker,
    task: buildJobTaskPrompt(spec),
    callbackUrl,
  })
  await db
    .update(jobSpec)
    .set({ workerAgentId: worker.id, onchainJobId: jobId, agentTaskId: taskId })
    .where(eq(jobSpec.specHash, spec.specHash))
}

/** Accept a job on-chain as `worker` and dispatch its real run. Throws if
 *  the worker already failed this job lineage's tests, or if another
 *  worker holds the off-chain claim (fast, no gas wasted). A dispatch
 *  failure after a successful on-chain accept is logged, not thrown — the
 *  accept can't be undone here, and auto-mine's self-heal retries it. */
export async function acceptAndDispatchJob(
  worker: AgentRow,
  jobId: number,
  callbackUrl: string,
): Promise<{ txHash: string }> {
  const { acceptJob, readJobs } = await import('@/lib/onchain/labor')

  const jobs = await readJobs()
  const job = jobs.find((j) => j.id === jobId)
  const [spec] = job ? await db.select().from(jobSpec).where(eq(jobSpec.specHash, job.specHash)) : []

  assertNotSelfClaim(worker, job?.requester)

  if (spec?.failedWorkerIds?.includes(worker.id)) {
    throw new Error(
      "This agent already failed this job's acceptance tests — the repost is reserved for a different worker.",
    )
  }

  // Capability gate — covers BOTH manual accepts and auto-mine (which
  // also pre-filters, but this is the single chokepoint before gas is
  // spent on an accept the worker can't deliver on).
  if (spec) {
    const { workerCanDeliver } = await import('@/lib/artifacts')
    const kind = spec.deliverableKind ?? 'text'
    if (!workerCanDeliver(worker.capabilities, kind, spec.requiredCapabilities)) {
      throw new Error(
        `This job requires a ${kind} deliverable${(spec.requiredCapabilities ?? []).length ? ` plus [${spec.requiredCapabilities.join(', ')}]` : ''} — ${worker.name} hasn't declared the needed capabilities.`,
      )
    }
  }

  // Take the off-chain work-unit claim before spending gas. Losing here is
  // the normal contention path — cheap and instant, like a mining pool
  // handing each work unit to exactly one rig.
  if (spec && !(await claimJobSpec(spec.specHash, worker.id))) {
    throw new Error('Another worker is already claiming this job — try a different one.')
  }

  let txHash: string
  try {
    txHash = await acceptJob(worker.id, jobId)
  } catch (error) {
    if (spec) await releaseJobClaim(spec.specHash, worker.id) // free it for the next rig
    throw error
  }

  if (spec) {
    try {
      await dispatchAcceptedJob(worker, jobId, spec, callbackUrl)
    } catch (dispatchError) {
      console.error('[labor-dispatch] accepted on-chain but failed to start the real run:', dispatchError)
    }
  }

  return { txHash }
}

/**
 * Accept a job for an EXTERNAL live worker — an MCP session (Claude /
 * ChatGPT connected via the connector) that will do the work itself,
 * inside its own conversation, and submit via the normal callback path.
 *
 * Same gates as acceptAndDispatchJob (failed-lineage block, capability
 * match, off-chain claim, on-chain accept); the difference is dispatch:
 * there is no runtime to send the task TO — the caller IS the runtime —
 * so the agent task is created directly in 'running' and the composed
 * prompt is handed back for the session to execute. Submission then flows
 * through /api/runtime/callback exactly like every other worker, so
 * grading, credit, and settlement cannot drift.
 */
export async function acceptJobForExternalWorker(
  worker: AgentRow,
  jobId: number,
): Promise<{ taskId: string; prompt: string; bounty: number }> {
  const { acceptJob, readJobs } = await import('@/lib/onchain/labor')

  const jobs = await readJobs({ maxAgeMs: 0 })
  const job = jobs.find((j) => j.id === jobId)
  if (!job) throw new Error('Job not found on-chain')
  if (job.status !== 'Open') throw new Error(`Job #${jobId} is ${job.status}, not Open`)
  const [spec] = await db.select().from(jobSpec).where(eq(jobSpec.specHash, job.specHash))
  if (!spec) throw new Error('Job has no off-chain spec — nothing to actually do')

  assertNotSelfClaim(worker, job.requester)

  if (spec.failedWorkerIds?.includes(worker.id)) {
    throw new Error("This agent already failed this job's acceptance tests — the repost is reserved for a different worker.")
  }
  {
    const { workerCanDeliver } = await import('@/lib/artifacts')
    const kind = spec.deliverableKind ?? 'text'
    if (!workerCanDeliver(worker.capabilities, kind, spec.requiredCapabilities)) {
      throw new Error(
        `This job requires a ${kind} deliverable${(spec.requiredCapabilities ?? []).length ? ` plus [${spec.requiredCapabilities.join(', ')}]` : ''} — agent ${worker.name} hasn't declared the needed capabilities.`,
      )
    }
  }
  if (Math.round(parseFloat(worker.creditScore)) < job.minScore) {
    throw new Error(`Job requires credit score ≥ ${job.minScore}; ${worker.name} has ${Math.round(parseFloat(worker.creditScore))}.`)
  }
  if (!(await claimJobSpec(spec.specHash, worker.id))) {
    throw new Error('Another worker is already claiming this job — try a different one.')
  }

  try {
    await acceptJob(worker.id, jobId)
  } catch (error) {
    await releaseJobClaim(spec.specHash, worker.id)
    throw error
  }

  const { nanoid } = await import('nanoid')
  const { agentTask } = await import('@/lib/db/schema')
  const taskId = `task-${nanoid(10)}`
  const prompt = buildJobTaskPrompt(spec)
  await db.insert(agentTask).values({
    id: taskId,
    userId: worker.userId,
    agentId: worker.id,
    task: prompt,
    status: 'running',
  })
  await db
    .update(jobSpec)
    .set({ workerAgentId: worker.id, onchainJobId: jobId, agentTaskId: taskId })
    .where(eq(jobSpec.specHash, spec.specHash))

  return { taskId, prompt, bounty: job.bounty }
}
