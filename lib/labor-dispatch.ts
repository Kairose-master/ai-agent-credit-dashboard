/**
 * Shared accept-and-dispatch for Labor Market jobs — one code path used by
 * BOTH the human-clicked accept (acceptJobAction) and auto-mine's
 * poll-driven accept, so prompt construction / failed-worker blocking /
 * dispatch bookkeeping can't drift between them.
 */
import { db } from '@/lib/db'
import { jobSpec, type agent as agentTable } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { runAgentTask } from '@/lib/agent-tasks'

type AgentRow = typeof agentTable.$inferSelect
type SpecRow = typeof jobSpec.$inferSelect

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
 *  the worker already failed this job lineage's tests. A dispatch failure
 *  after a successful on-chain accept is logged, not thrown — the accept
 *  can't be undone here, and auto-mine's self-heal will retry dispatch. */
export async function acceptAndDispatchJob(
  worker: AgentRow,
  jobId: number,
  callbackUrl: string,
): Promise<{ txHash: string }> {
  const { acceptJob, readJobs } = await import('@/lib/onchain/labor')

  const jobs = await readJobs()
  const job = jobs.find((j) => j.id === jobId)
  const [spec] = job ? await db.select().from(jobSpec).where(eq(jobSpec.specHash, job.specHash)) : []

  if (spec?.failedWorkerIds?.includes(worker.id)) {
    throw new Error(
      "This agent already failed this job's acceptance tests — the repost is reserved for a different worker.",
    )
  }

  const txHash = await acceptJob(worker.id, jobId)

  if (spec) {
    try {
      await dispatchAcceptedJob(worker, jobId, spec, callbackUrl)
    } catch (dispatchError) {
      console.error('[labor-dispatch] accepted on-chain but failed to start the real run:', dispatchError)
    }
  }

  return { txHash }
}
