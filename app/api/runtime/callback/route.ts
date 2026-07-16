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

/** Retries a step that runs AFTER a prior on-chain action already
 *  succeeded and can't be undone (escrow released, refund issued) — a
 *  transient DB/RPC failure here would otherwise permanently strand the
 *  bookkeeping for money that already moved, since the on-chain status
 *  guards in this file only allow one attempt per job. */
async function retry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 500): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)))
    }
  }
  throw lastError
}

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
    const verifiedOutcome = await settleVerifiedTask(taskId, agentId, String(body?.output ?? ''))
    if (verifiedOutcome !== null) {
      const { publishValidation } = await import('@/lib/onchain/erc8004')
      await publishValidation(agentId, verifiedOutcome ? 100 : 0, 'proving-ground', `task-${taskId}`)
    }

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
async function settleVerifiedTask(
  agentTaskId: string,
  solverAgentId: string,
  output: string,
): Promise<boolean | null> {
  const [row] = await db
    .select()
    .from(verifiableTask)
    .where(eq(verifiableTask.agentTaskId, agentTaskId))
  if (!row || row.status !== 'solving') return null

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
      return true
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
      return false
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
  return null
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

  let submitted = false
  try {
    const { keccak256, toHex } = await import('viem')
    const { submitWork } = await import('@/lib/onchain/labor')
    const resultHash = keccak256(toHex(output || '(empty output)'))
    await submitWork(spec.workerAgentId, spec.onchainJobId, resultHash)
    submitted = true
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

      // Mirror the graded fact into the ERC-8004 Validation Registry — but
      // only if the submission this grade is FOR actually landed on-chain
      // via submitWork above. Otherwise this would publish an on-chain
      // validation claim referencing a submission the chain has no record
      // of (submitWork failures are caught and logged, not fatal, so
      // grading still runs on the raw output — that's fine for the DB
      // credit event below, which is genuine worker-quality signal either
      // way, but not for an on-chain attestation tied to a specific job
      // submission that never actually recorded).
      if (submitted) {
        const { publishValidation } = await import('@/lib/onchain/erc8004')
        await publishValidation(
          spec.workerAgentId,
          grade.passed ? 100 : 0,
          'acceptance-tests',
          `job-${spec.onchainJobId}`,
        )
      }
    }

    if (grade.passed === false) {
      await returnFailedJobToMarket(spec)
    } else if (grade.passed === true) {
      await autoApprovePassedJob(spec)
    }
  } catch (error) {
    console.error('[runtime/callback] acceptance-test grading failed:', error)
  }
}

// Bounds how much a single compromised/over-lenient grader verdict can
// release with zero requester involvement. Above this, a passing job still
// waits for the requester's own "Approve & pay" — auto-approve exists to
// stop small/unwatched jobs (seed jobs, idle requesters) from stranding a
// worker unpaid, not to hand a grader unlimited fund-release authority.
const AUTO_APPROVE_MAX_BOUNTY_USD = Number(process.env.AUTO_APPROVE_MAX_BOUNTY_USD ?? 50)

/**
 * Acceptance tests passed — an independently graded, objective fact, the
 * same authority the failure path (returnFailedJobToMarket) already acts on
 * automatically. Release the escrow immediately instead of leaving the job
 * "Submitted" and waiting on a human "Approve & pay" click that may never
 * come — e.g. a requester agent nobody is actively watching a dashboard for
 * (a seeded/house job, an auto-mined job for an idle requester). Without
 * this, a worker can do the work, pass grading, and simply never get paid.
 *
 * The actual authorization for this is `spec.autoApprove` — the requester's
 * own explicit choice, recorded on an authenticated call to postJobAction
 * at the time THEY posted the job (default true, opt-out available in the
 * Post-a-Job form). It is NOT inferred here from testCode's mere presence:
 * `approveJob` itself has no authorization logic of its own (it just signs
 * as `spec.requesterAgentId`), so the gate has to be enforced before it's
 * called, from a decision the requester actually made. AUTO_APPROVE_MAX_BOUNTY_USD
 * is the second, independent layer — even a job that opted in only auto-
 * releases up to that ceiling, bounding what a single grader mistake can
 * move regardless of consent.
 */
async function autoApprovePassedJob(spec: typeof jobSpec.$inferSelect): Promise<void> {
  if (!spec.requesterAgentId || !spec.workerAgentId || spec.onchainJobId === null) return
  if (!spec.autoApprove) return // requester opted out — stays Submitted for their own review

  let approvedTxHash: string | null = null
  try {
    const { readJobs, approveJob } = await import('@/lib/onchain/labor')
    const jobs = await readJobs()
    const job = jobs.find((j) => j.id === spec.onchainJobId)
    if (!job || job.status !== 'Submitted') return

    if (Number.isFinite(AUTO_APPROVE_MAX_BOUNTY_USD) && job.bounty > AUTO_APPROVE_MAX_BOUNTY_USD) {
      console.log(
        `[runtime/callback] job ${spec.onchainJobId} passed tests but bounty $${job.bounty} exceeds the $${AUTO_APPROVE_MAX_BOUNTY_USD} auto-approve cap — left Submitted for the requester to approve manually`,
      )
      return
    }

    approvedTxHash = await approveJob(spec.requesterAgentId, spec.onchainJobId)

    // approveJob just moved real funds on-chain and flipped the job to
    // Completed — from here there's no path back to "Submitted", so a
    // transient failure recording the credit event would otherwise strand
    // it forever (any retry of this function would no-op on the status
    // guard above). Retry the DB-only half before giving up.
    const { creditWorkerForJob } = await import('@/app/actions/labor')
    await retry(() => creditWorkerForJob(job.worker, spec.onchainJobId!, job.bounty, approvedTxHash!))

    await logPlatformEvent(
      'JOB_AUTO_APPROVED',
      `"${spec.title}" — acceptance tests passed (independent grader), escrow released automatically`,
    )
  } catch (error) {
    console.error('[runtime/callback] auto-approve failed:', error)
    if (approvedTxHash) {
      // Escrow already released on-chain — the worker was paid — but
      // recording that fact (credit event, reputation) failed even after
      // retries. Unlike an approveJob failure (which leaves the job
      // Submitted for a clean retry), this is unrecoverable automatically:
      // surface it so an admin can backfill the credit event by hand.
      await logPlatformEvent(
        'JOB_AUTO_APPROVE_INCOMPLETE',
        `"${spec.title}" — escrow released (tx ${approvedTxHash.slice(0, 10)}…) but credit recording failed after retries — job #${spec.onchainJobId} needs a manual credit backfill`,
      ).catch(() => {})
    }
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

  let refunded = false
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
    refunded = true // irreversible from here — resolveDispute already paid out

    // 2. Repost the same spec as a fresh on-chain job, blocking every worker
    //    that already failed this lineage. Retry: the refund above can't be
    //    undone, so a transient failure here shouldn't silently strand the
    //    job with no replacement and no payout for anyone.
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
      autoApprove: spec.autoApprove, // carry the requester's original consent choice forward, don't silently reset it
    })
    const txHash = await retry(() => postJob(spec.requesterAgentId!, job.bounty, job.minScore, newSpecHash))

    await logPlatformEvent(
      'JOB_AUTO_REPOSTED',
      `"${spec.title}" — tests failed, escrow auto-refunded, reposted for a different worker (attempt ${spec.repostCount + 2})`,
    )
    console.log(`[runtime/callback] job ${spec.onchainJobId} auto-returned to market (repost tx ${txHash})`)
  } catch (error) {
    console.error('[runtime/callback] auto-return to market failed:', error)
    if (refunded) {
      // The refund already completed on-chain and is irreversible, but the
      // replacement job failed to post even after retries — this does NOT
      // land in the admin dispute queue (the dispute is already Refunded,
      // not Disputed, so there's nothing left there to review). Surfaced
      // here instead so an admin can manually repost the spec.
      await logPlatformEvent(
        'JOB_REPOST_FAILED',
        `"${spec.title}" — refund completed but repost failed after retries — job #${spec.onchainJobId} needs a manual repost`,
      ).catch(() => {})
    }
  }
}
