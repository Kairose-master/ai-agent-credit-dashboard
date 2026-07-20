import { db } from '@/lib/db'
import { agentEvent, agentTask, verifiableTask, jobSpec } from '@/lib/db/schema'
import { recalculateCredit } from '@/lib/credit-engine'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { extractAnswer } from '@/lib/verifiable/problems'
import { resolveCallbackAuth } from '@/lib/webhook'
import { logPlatformEvent } from '@/lib/platform-feed'
import { autoApprovePassedJob, returnFailedJobToMarket } from '@/lib/labor-settle'

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
    // Binary deliverables (images/files) ride alongside the text output.
    // Validated hard before anything is stored; a bad artifact set fails
    // the submission with an actionable error instead of dropping files.
    const { validateArtifacts } = await import('@/lib/artifacts')
    const artifacts = validateArtifacts(body?.artifacts)
    if (artifacts.length > 0) {
      const { artifact } = await import('@/lib/db/schema')
      await db.insert(artifact).values(
        artifacts.map((a) => ({
          id: `art-${nanoid(16)}`,
          taskId,
          agentId,
          name: a.name,
          mime: a.mime,
          dataBase64: a.dataBase64,
          url: a.url,
          size: a.size,
        })),
      )
    }

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
    // "Submit work" click, no more placeholder text. The verdict comes back
    // so the worker's log can show paid / refunded / manual review.
    const grading = await settleLaborMarketJob(taskId, String(body?.output ?? ''))

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

    return Response.json({ status: 'ok', grading })
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
/** What happened to the worker's submission — returned to the worker so its
 *  log can show the real outcome (paid / refunded / awaiting manual review)
 *  instead of stopping at "submitted". */
type GradeReport = { passed: boolean | null; settled: 'paid' | 'refunded' | 'manual'; reason: string }

async function settleLaborMarketJob(agentTaskId: string, output: string): Promise<GradeReport | null> {
  const [spec] = await db.select().from(jobSpec).where(eq(jobSpec.agentTaskId, agentTaskId))
  if (!spec || !spec.workerAgentId || spec.onchainJobId === null) return null

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

  // Three independent grading paths produce the same verdict shape:
  // Python asserts for code jobs, a vision LLM for image deliverables,
  // and an LLM reviewer for text jobs with acceptance criteria. Only
  // audio/video/file (binary the graders can't inspect) and text jobs
  // without criteria stay ungraded for manual requester review.
  const isImageJob = spec.deliverableKind === 'image'
  const isAudioJob = spec.deliverableKind === 'audio' && Boolean(spec.acceptanceCriteria?.trim())
  const isLlmGradableText =
    !spec.testCode && !isImageJob && (spec.deliverableKind ?? 'text') === 'text' && Boolean(spec.acceptanceCriteria?.trim())
  if (!spec.testCode && !isImageJob && !isAudioJob && !isLlmGradableText) return null
  try {
    let grade: { passed: boolean | null; output: string; gradedAt: string }
    if (isImageJob) {
      const { artifact, agent } = await import('@/lib/db/schema')
      const arts = await db.select().from(artifact).where(eq(artifact.taskId, agentTaskId))
      const [requesterAgent] = spec.requesterAgentId
        ? await db.select().from(agent).where(eq(agent.id, spec.requesterAgentId))
        : []
      const { gradeImageSubmission } = await import('@/lib/vision-grading')
      grade = await gradeImageSubmission(spec, arts, requesterAgent?.userId ?? null)
    } else if (isAudioJob) {
      const { artifact, agent } = await import('@/lib/db/schema')
      const arts = await db.select().from(artifact).where(eq(artifact.taskId, agentTaskId))
      const [requesterAgent] = spec.requesterAgentId
        ? await db.select().from(agent).where(eq(agent.id, spec.requesterAgentId))
        : []
      const { gradeAudioSubmission } = await import('@/lib/audio-grading')
      grade = await gradeAudioSubmission(spec, arts, requesterAgent?.userId ?? null)
    } else if (isLlmGradableText) {
      const { agent } = await import('@/lib/db/schema')
      const [requesterAgent] = spec.requesterAgentId
        ? await db.select().from(agent).where(eq(agent.id, spec.requesterAgentId))
        : []
      const { gradeTextSubmission } = await import('@/lib/text-grading')
      grade = await gradeTextSubmission(spec, output, requesterAgent?.userId ?? null)
    } else {
      const { extractPythonCode, gradeSubmission } = await import('@/lib/code-grading')
      const solutionCode = extractPythonCode(output)
      grade = solutionCode
        ? await gradeSubmission(solutionCode, spec.testCode!)
        : {
            passed: false,
            output: 'No Python code block found in the submission (the task required one).',
            gradedAt: new Date().toISOString(),
          }
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
        `"${spec.title}" — ${isImageJob ? 'vision review' : isAudioJob ? 'audio transcription review' : isLlmGradableText ? 'LLM review' : 'acceptance tests'} ${grade.passed ? 'passed' : 'FAILED'} (independent grader)`,
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
          isImageJob ? 'vision-review' : isAudioJob ? 'audio-review' : isLlmGradableText ? 'llm-review' : 'acceptance-tests',
          `job-${spec.onchainJobId}`,
        )
      }
    }

    if (grade.passed === false) {
      await returnFailedJobToMarket(spec)
      return { passed: false, settled: 'refunded', reason: grade.output }
    } else if (grade.passed === true) {
      await autoApprovePassedJob(spec)
      return { passed: true, settled: 'paid', reason: grade.output }
    }
    // passed:null — grading unavailable; job waits for manual requester review.
    return { passed: null, settled: 'manual', reason: grade.output }
  } catch (error) {
    console.error('[runtime/callback] acceptance-test grading failed:', error)
    return null
  }
}
