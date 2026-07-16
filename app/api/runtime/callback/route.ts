import { db } from '@/lib/db'
import { agentEvent, agentTask, verifiableTask, jobSpec } from '@/lib/db/schema'
import { recalculateCredit } from '@/lib/credit-engine'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { extractAnswer } from '@/lib/verifiable/problems'
import { resolveCallbackAuth } from '@/lib/webhook'
import { logPlatformEvent } from '@/lib/platform-feed'

// Verified-task settlement runs two UserOps; allow time for bundler inclusion.
export const maxDuration = 300

/**
 * POST /api/runtime/callback
 * Called by the Python runtime OR a user's own BYO-agent webhook when a task
 * finishes. Persists the behavioral events and recalculates the agent's
 * credit, then records the result on the task row for the dashboard to poll.
 *
 * Auth is resolved PER-TASK'S OWNING AGENT (not one global secret): a
 * platform-runtime task requires RUNTIME_SHARED_SECRET; a webhook-runtime
 * task requires that agent's own secret — so one agent's webhook can never
 * forge a callback for another agent's task.
 *
 * Processing is claimed atomically (running → processing) so a retried
 * callback can't double-insert events.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const taskId = body?.task_id as string | undefined
  if (!taskId) return Response.json({ error: 'Missing task_id' }, { status: 400 })

  const [taskRow] = await db.select().from(agentTask).where(eq(agentTask.id, taskId))
  if (!taskRow) return Response.json({ status: 'ignored' }) // unknown task — idempotent no-op

  const auth = await resolveCallbackAuth(taskRow.agentId)
  if (auth.required && request.headers.get('x-runtime-secret') !== auth.secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Atomically claim the task so concurrent/retried callbacks process once.
  const claimed = await db
    .update(agentTask)
    .set({ status: 'processing', updatedAt: new Date() })
    .where(and(eq(agentTask.id, taskId), eq(agentTask.status, 'running')))
    .returning()

  if (claimed.length === 0) {
    // Already processed — acknowledge idempotently.
    return Response.json({ status: 'ignored' })
  }

  const agentId = claimed[0].agentId
  const events = Array.isArray(body?.events) ? body.events : []

  try {
    if (events.length > 0) {
      await db.insert(agentEvent).values(
        events.map((event: any) => ({
          id: nanoid(),
          agentId,
          taskId,
          eventType: String(event.event_type),
          success: Boolean(event.success),
          executionTime: Number(event.execution_time) || 0,
          tokenCost: Number(event.token_cost) || 0,
          qualityScore:
            event.quality_score === null || event.quality_score === undefined
              ? null
              : Number(event.quality_score).toFixed(3),
          detail: event.detail ?? {},
        })),
      )
    }

    // Verified task? Grade against the hidden answer and settle the escrow.
    await settleVerifiedTask(taskId, agentId, String(body?.output ?? ''))

    // Labor Market job? Submit the REAL output on-chain — no more manual
    // "Submit work" click, no more placeholder text.
    await settleLaborMarketJob(taskId, String(body?.output ?? ''))

    const credit = await recalculateCredit(agentId)

    await db
      .update(agentTask)
      .set({
        status: 'completed',
        output: String(body?.output ?? ''),
        result: {
          success: Boolean(body?.success),
          plan: body?.plan ?? '',
          qualityScore: Number(body?.quality_score) || 0,
          evaluation: body?.evaluation ?? null,
          executionTime: Number(body?.execution_time) || 0,
          tokenCost: Number(body?.token_cost) || 0,
        },
        credit: {
          previousScore: credit.previousScore,
          score: credit.score,
          rating: credit.rating,
          creditLimit: credit.creditLimit,
          riskLevel: credit.riskLevel,
          calculationReason: credit.calculationReason,
          breakdown: credit.breakdown,
        },
        updatedAt: new Date(),
      })
      .where(eq(agentTask.id, taskId))

    return Response.json({ status: 'ok' })
  } catch (error) {
    await db
      .update(agentTask)
      .set({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(agentTask.id, taskId))
    console.error('[runtime/callback] Failed to process task', taskId, error)
    return Response.json({ error: 'Failed to process callback' }, { status: 500 })
  }
}

/**
 * If this agent run was the solve of a verified task: grade the output
 * against the hidden ground-truth answer (grader ≠ solver), and on a correct
 * answer settle the on-chain escrow via commit-reveal from the solver's
 * smart account. Both outcomes are recorded as VERIFIED_TASK_* events — the
 * factual quality signal the credit engine weighs above self-evaluation.
 */
async function settleVerifiedTask(agentTaskId: string, solverAgentId: string, output: string) {
  const [row] = await db
    .select()
    .from(verifiableTask)
    .where(eq(verifiableTask.agentTaskId, agentTaskId))
  if (!row || row.status !== 'solving') return

  const submitted = extractAnswer(output)
  const correct = submitted !== null && submitted === row.answer

  try {
    if (correct && row.onchainId) {
      await db
        .update(verifiableTask)
        .set({ status: 'settling', submittedAnswer: submitted, updatedAt: new Date() })
        .where(eq(verifiableTask.id, row.id))

      const { commitAndReveal } = await import('@/lib/onchain/verified')
      const { revealTx } = await commitAndReveal(
        row.solverAgentId,
        row.onchainId,
        row.answer,
        row.salt as `0x${string}`,
      )

      await db
        .update(verifiableTask)
        .set({ status: 'completed', settleTxHash: revealTx, updatedAt: new Date() })
        .where(eq(verifiableTask.id, row.id))

      await db.insert(agentEvent).values({
        id: nanoid(),
        agentId: solverAgentId,
        taskId: `verified-${row.id}`,
        eventType: 'VERIFIED_TASK_COMPLETED',
        success: true,
        executionTime: 0,
        tokenCost: 0,
        qualityScore: '1.000', // graded fact, not self-opinion
        detail: {
          difficulty: row.difficulty,
          bounty: row.bountyUsd,
          problem: row.problem,
          txHash: revealTx,
          onchain: true,
        },
      })
    } else {
      await db
        .update(verifiableTask)
        .set({ status: 'failed', submittedAnswer: submitted, updatedAt: new Date() })
        .where(eq(verifiableTask.id, row.id))

      await db.insert(agentEvent).values({
        id: nanoid(),
        agentId: solverAgentId,
        taskId: `verified-${row.id}`,
        eventType: 'VERIFIED_TASK_FAILED',
        success: false,
        executionTime: 0,
        tokenCost: 0,
        qualityScore: '0.000',
        detail: {
          difficulty: row.difficulty,
          problem: row.problem,
          submitted: submitted ?? '(no FINAL_ANSWER found)',
        },
      })
    }
  } catch (error) {
    console.error('[runtime/callback] verified settlement failed:', error)
    await db
      .update(verifiableTask)
      .set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(verifiableTask.id, row.id))
  }
}

/**
 * If this agent run was a Labor Market worker actually doing an accepted
 * job: submit the REAL output on-chain now, automatically. The requester
 * then reviews genuine work, not a placeholder — this is what makes
 * "the agent did the job" true instead of a UI button pretending it did.
 *
 * If the job carries acceptance tests (auto-graded code job), the submitted
 * code is additionally run against them on the PLATFORM runtime and the
 * pass/fail fact is recorded — as evidence on the job (for the requester and
 * any dispute reviewer) and as a graded-fact credit event for the worker
 * (JOB_TESTS_PASSED/FAILED — same trust class as VERIFIED_TASK_*, because a
 * test run is a fact, not an LLM's opinion of itself).
 */
async function settleLaborMarketJob(agentTaskId: string, output: string): Promise<void> {
  const [spec] = await db.select().from(jobSpec).where(eq(jobSpec.agentTaskId, agentTaskId))
  if (!spec || !spec.workerAgentId || spec.onchainJobId === null) return

  try {
    const { keccak256, toHex } = await import('viem')
    const { submitWork } = await import('@/lib/onchain/labor')
    const resultHash = keccak256(toHex(output || '(empty output)'))
    await submitWork(spec.workerAgentId, spec.onchainJobId, resultHash)
    await logPlatformEvent('JOB_SUBMITTED', `"${spec.title}" — worker submitted real output for review`)
  } catch (error) {
    console.error('[runtime/callback] labor market auto-submit failed:', error)
  }

  if (!spec.testCode) return
  try {
    const { extractPythonCode, gradeSubmission } = await import('@/lib/code-grading')
    const solutionCode = extractPythonCode(output)
    const grade = solutionCode
      ? await gradeSubmission(solutionCode, spec.testCode)
      : {
          passed: false,
          output: 'No Python code block found in the submission (the task required one).',
          gradedAt: new Date().toISOString(),
        }

    await db.update(jobSpec).set({ testResult: grade }).where(eq(jobSpec.specHash, spec.specHash))

    // passed:null means grading itself was unavailable — that's an infra
    // fact about us, not behavioral data about the worker; no credit event.
    if (grade.passed !== null) {
      await db.insert(agentEvent).values({
        id: nanoid(),
        agentId: spec.workerAgentId,
        taskId: `job-${spec.onchainJobId}-tests`,
        eventType: grade.passed ? 'JOB_TESTS_PASSED' : 'JOB_TESTS_FAILED',
        success: grade.passed,
        executionTime: 0,
        tokenCost: 0,
        qualityScore: grade.passed ? '1.000' : '0.000', // graded fact, not self-opinion
        detail: { jobId: spec.onchainJobId, testOutput: grade.output.slice(0, 500) },
      })
      await logPlatformEvent(
        grade.passed ? 'JOB_TESTS_PASSED' : 'JOB_TESTS_FAILED',
        `"${spec.title}" — acceptance tests ${grade.passed ? 'passed' : 'FAILED'} (independent grader)`,
      )
    }

    if (grade.passed === false) {
      await returnFailedJobToMarket(spec)
    }
  } catch (error) {
    console.error('[runtime/callback] acceptance-test grading failed:', error)
  }
}

const MAX_AUTO_REPOSTS = 2

/**
 * Failed acceptance tests are an objective verdict — the tests ARE the
 * agreed contract, shown to the worker before it started. So instead of
 * parking the job in Submitted and asking the requester to click Dispute on
 * work that already mechanically failed, return it to the market
 * automatically: dispute → arbiter refunds the requester (the evidence is
 * the grader's own output, so no human review adds anything) → repost the
 * same spec as a fresh job for a DIFFERENT worker (failed workers are
 * blocked from re-accepting the repost off-chain). Capped at
 * MAX_AUTO_REPOSTS per spec lineage so a broken/impossible test suite can't
 * burn escrow round-trips forever — past the cap the job stays Submitted
 * for the requester to judge manually (their tests are the thing most
 * likely at fault by then).
 */
async function returnFailedJobToMarket(spec: typeof jobSpec.$inferSelect): Promise<void> {
  if (!spec.requesterAgentId || !spec.workerAgentId || spec.onchainJobId === null) return
  if (spec.repostCount >= MAX_AUTO_REPOSTS) {
    console.warn(`[runtime/callback] job ${spec.onchainJobId} failed tests but hit the auto-repost cap — leaving for manual review`)
    return
  }

  try {
    const { readJobs, raiseDispute, resolveDispute, postJob } = await import('@/lib/onchain/labor')
    const jobs = await readJobs()
    const job = jobs.find((j) => j.id === spec.onchainJobId)
    if (!job || job.status !== 'Submitted') return

    // 1. Requester's agent disputes; the arbiter refunds — both platform-
    //    signed, justified by the objective test verdict.
    await raiseDispute(spec.requesterAgentId, spec.onchainJobId)
    await db
      .update(jobSpec)
      .set({ disputeNote: 'Auto: acceptance tests failed (independent grader) — refunded and reposted' })
      .where(eq(jobSpec.specHash, spec.specHash))
    await resolveDispute(spec.onchainJobId, false)

    // 2. Repost the same spec as a fresh on-chain job, blocking every worker
    //    that already failed this lineage.
    const { keccak256, toHex } = await import('viem')
    const newSpecHash = keccak256(
      toHex(JSON.stringify({ title: spec.title, agent: spec.requesterAgentId, nonce: nanoid() })),
    )
    const failedWorkers = [...new Set([...(spec.failedWorkerIds ?? []), spec.workerAgentId])]
    await db.insert(jobSpec).values({
      specHash: newSpecHash,
      title: spec.title,
      description: spec.description,
      acceptanceCriteria: spec.acceptanceCriteria,
      requesterAgentId: spec.requesterAgentId,
      attachmentUrl: spec.attachmentUrl,
      attachmentName: spec.attachmentName,
      testCode: spec.testCode,
      repostCount: spec.repostCount + 1,
      failedWorkerIds: failedWorkers,
    })
    const txHash = await postJob(spec.requesterAgentId, job.bounty, job.minScore, newSpecHash)

    await logPlatformEvent(
      'JOB_AUTO_REPOSTED',
      `"${spec.title}" — tests failed, escrow auto-refunded, reposted for a different worker (attempt ${spec.repostCount + 2})`,
    )
    console.log(`[runtime/callback] job ${spec.onchainJobId} auto-returned to market (repost tx ${txHash})`)
  } catch (error) {
    // Money already partially moved is the worst case here (e.g. disputed
    // but not resolved) — that lands in the existing admin dispute queue,
    // which is exactly the manual fallback for this flow.
    console.error('[runtime/callback] auto-return to market failed:', error)
  }
}
