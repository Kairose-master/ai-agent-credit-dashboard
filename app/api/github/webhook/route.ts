/**
 * POST /api/github/webhook — the grading and settlement signal for GitHub
 * repo jobs (docs/github-jobs.md, Phase 2).
 *
 * Three facts arrive here, and only these three matter:
 *   check_suite / check_run completed  → the requester's OWN CI verdict,
 *       written into `testResult` (the same field every other grader writes,
 *       so nothing downstream changes). CI green does NOT move money.
 *   pull_request merged                → the requester's approval. THIS is
 *       what releases the escrow (autoApprovePassedJob, authorization
 *       'merge').
 *   pull_request closed unmerged       → the dispute path: refund + repost
 *       for a different worker, exactly as a failed grade does.
 *
 * Every payload is HMAC-verified against the App's webhook secret before a
 * single byte of it is trusted. Unknown/unmatched deliveries are a 200 no-op:
 * GitHub retries non-2xx, and an installation on an unrelated repo is normal.
 */
import { db } from '@/lib/db'
import { jobSpec } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

export const maxDuration = 300 // settlement runs on-chain UserOps

type Verdict = { passed: boolean | null; output: string; gradedAt: string }

export async function POST(request: Request) {
  const raw = await request.text()

  const { getGithubWebhookSecret, verifyGithubSignature } = await import('@/lib/github-app')
  const secret = await getGithubWebhookSecret()
  if (!secret) {
    console.error('[github/webhook] no webhook secret configured — rejecting delivery')
    return Response.json({ error: 'Webhook not configured' }, { status: 503 })
  }
  if (!verifyGithubSignature(raw, request.headers.get('x-hub-signature-256'), secret)) {
    return Response.json({ error: 'Bad signature' }, { status: 401 })
  }

  const event = request.headers.get('x-github-event') ?? ''
  let payload: any
  try {
    payload = JSON.parse(raw)
  } catch {
    return Response.json({ error: 'Bad payload' }, { status: 400 })
  }

  try {
    if (event === 'pull_request') return await handlePullRequest(payload)
    if (event === 'check_suite' || event === 'check_run') return await handleCheck(event, payload)
    if (event === 'issues') return await handleIssue(payload)
    return Response.json({ status: 'ignored', event })
  } catch (error) {
    console.error(`[github/webhook] ${event} handling failed:`, error)
    // 500 so GitHub retries — settlement paths are all idempotent.
    return Response.json({ error: 'Handler failed' }, { status: 500 })
  }
}

/** Find the job this PR belongs to. Repo + PR number is the whole key. */
async function specForPr(repoFullName: string, prNumber: number) {
  const [spec] = await db
    .select()
    .from(jobSpec)
    .where(and(eq(jobSpec.repoFullName, repoFullName), eq(jobSpec.prNumber, prNumber)))
  return spec ?? null
}

async function writeVerdict(specHash: string, verdict: Verdict, ciStatus: string | null) {
  await db
    .update(jobSpec)
    .set(ciStatus === null ? { testResult: verdict } : { testResult: verdict, ciStatus })
    .where(eq(jobSpec.specHash, specHash))
}


/**
 * The label-to-bounty bot: `bounty:$15` on a GitHub issue IS the job posting.
 *
 * labeled   → resolve the labeler through github_identities to a platform
 *             account (the GitHub sign-in is the identity bridge), escrow
 *             from their funded agent, post the repo job, comment back.
 *             Not linked → the comment carries the link instructions, so a
 *             failed label is an onboarding surface, not a silent no-op.
 * unlabeled / closed → cancel-and-refund, but ONLY while the job is still
 *             Open on-chain — a claimed job is a worker's committed work and
 *             a label cannot destroy it.
 *
 * Requires the App to hold Issues: Read & write and subscribe to Issue
 * events (docs/github-jobs.md). Idempotent per (repo, issue): re-delivered
 * webhooks find the existing open job and stop.
 */
async function handleIssue(payload: any): Promise<Response> {
  const action = String(payload?.action ?? '')
  const repoFullName = String(payload?.repository?.full_name ?? '')
  const { issueNumberOf, parseBountyLabel, bountyLabelOn } = await import('@/lib/bounty-label')
  const issueNumber = issueNumberOf(payload)
  if (!repoFullName || issueNumber === null) return Response.json({ status: 'ignored' })

  const origin = 'https://ai-agent-credit-dashboard.vercel.app'
  const { commentOnPr } = await import('@/lib/github-app') // issues share the comments API with PRs

  if (action === 'labeled') {
    const bountyUsd = parseBountyLabel(String(payload?.label?.name ?? ''))
    if (bountyUsd === null) return Response.json({ status: 'ignored', reason: 'not a bounty label' })

    const { validateLabelBounty, briefFromIssue, bountyPostedComment, notLinkedComment } = await import('@/lib/bounty-label')
    const check = validateLabelBounty(bountyUsd)
    if (!check.ok) {
      await commentOnPr(repoFullName, issueNumber, `⚠️ ${check.reason}`)
      return Response.json({ status: 'rejected', reason: check.reason })
    }

    // Idempotency: one open job per (repo, issue).
    await (await import('@/lib/db/ensure-columns')).ensureJobSpecColumns()
    const existing = (await db.select().from(jobSpec)).find(
      (sp) => sp.repoFullName === repoFullName && sp.issueNumber === issueNumber && sp.onchainJobId !== null,
    )
    if (existing) {
      const { readJobs } = await import('@/lib/onchain/labor')
      const jobs = await readJobs().catch(() => [])
      const live = jobs.find((j) => j.id === existing.onchainJobId)
      if (live && (live.status === 'Open' || live.status === 'Accepted' || live.status === 'Submitted')) {
        return Response.json({ status: 'ignored', reason: 'job already live for this issue' })
      }
    }

    // Identity bridge: the LABELER pays, resolved via their linked GitHub.
    const senderGithubId = String(payload?.sender?.id ?? '')
    const { userIdForGithubUser } = await import('@/lib/github-identity')
    const userId = senderGithubId ? await userIdForGithubUser(senderGithubId) : null
    if (!userId) {
      await commentOnPr(repoFullName, issueNumber, notLinkedComment(origin))
      return Response.json({ status: 'rejected', reason: 'labeler not linked' })
    }
    const { agent } = await import('@/lib/db/schema')
    const agents = await db.select().from(agent).where(eq(agent.userId, userId))
    const requester = agents.find((a) => a.smartAccountAddress)
    if (!requester) {
      await commentOnPr(repoFullName, issueNumber, `Your Ledgermind account has no provisioned agent to escrow from — create one at ${origin}/agents and re-add the label.`)
      return Response.json({ status: 'rejected', reason: 'no funded agent' })
    }

    try {
      const { postRepoJob } = await import('@/lib/repo-job-post')
      const issueTitle = String(payload?.issue?.title ?? `Issue #${issueNumber}`)
      const res = await postRepoJob({
        requesterAgentId: requester.id,
        repoFullName,
        title: issueTitle,
        brief: briefFromIssue({
          title: issueTitle,
          body: payload?.issue?.body ?? null,
          url: String(payload?.issue?.html_url ?? `https://github.com/${repoFullName}/issues/${issueNumber}`),
        }),
        issueUrl: String(payload?.issue?.html_url ?? ''),
        bountyUsd,
        issueNumber,
      })
      const [posted] = (await db.select().from(jobSpec).where(eq(jobSpec.specHash, res.specHash)))
      await commentOnPr(repoFullName, issueNumber, bountyPostedComment({ bountyUsd, jobId: posted?.onchainJobId ?? null, origin }))
      const { logPlatformEvent } = await import('@/lib/platform-feed')
      await logPlatformEvent('BOUNTY_LABELED', `A bounty label minted a $${bountyUsd} job from ${repoFullName}#${issueNumber}`).catch(() => {})
      return Response.json({ status: 'ok', posted: res.specHash })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await commentOnPr(repoFullName, issueNumber, `⚠️ Could not escrow the bounty: ${reason.slice(0, 300)}`)
      return Response.json({ status: 'error', reason }, { status: 200 }) // 200: GitHub should not retry a semantic failure
    }
  }

  if (action === 'unlabeled' || action === 'closed') {
    // Only act when the bounty label is genuinely gone (unlabeled fires per
    // label; closed ends the intent regardless).
    if (action === 'unlabeled') {
      const removed = parseBountyLabel(String(payload?.label?.name ?? ''))
      if (removed === null) return Response.json({ status: 'ignored' })
      if (bountyLabelOn(payload?.issue?.labels) !== null) {
        return Response.json({ status: 'ignored', reason: 'another bounty label remains' })
      }
    }
    const spec = (await db.select().from(jobSpec)).find(
      (sp) => sp.repoFullName === repoFullName && sp.issueNumber === issueNumber && sp.onchainJobId !== null,
    )
    if (!spec?.requesterAgentId || spec.onchainJobId === null) return Response.json({ status: 'ignored' })

    const { readJobs, cancelJob } = await import('@/lib/onchain/labor')
    const jobs = await readJobs({ maxAgeMs: 0 }).catch(() => [])
    const live = jobs.find((j) => j.id === spec.onchainJobId)
    // A claimed job is a worker's committed work — a label cannot destroy it.
    if (!live || live.status !== 'Open') {
      return Response.json({ status: 'ignored', reason: 'job not Open — a claimed job outlives its label' })
    }
    try {
      await cancelJob(spec.requesterAgentId, spec.onchainJobId)
      await commentOnPr(repoFullName, issueNumber, `↩️ Bounty cancelled and the escrow refunded (job was still unclaimed).`)
      const { logPlatformEvent } = await import('@/lib/platform-feed')
      await logPlatformEvent('BOUNTY_UNLABELED', `Bounty on ${repoFullName}#${issueNumber} cancelled while unclaimed — escrow refunded`).catch(() => {})
      return Response.json({ status: 'ok', cancelled: spec.onchainJobId })
    } catch (error) {
      console.error('[github/webhook] bounty cancel failed:', error)
      return Response.json({ status: 'error' }, { status: 200 })
    }
  }

  return Response.json({ status: 'ignored' })
}

/**
 * Record the CI verdict on the WORKER'S credit ledger.
 *
 * `logPlatformEvent` only writes the cosmetic activity feed. The score comes
 * from `agent_events`, and every other grader — pytest, vision, transcription,
 * LLM review — inserts one there. Repo jobs did not, which meant the strongest
 * grader we have (the buyer's own CI, run on GitHub's infrastructure, where the
 * worker cannot reach it) contributed nothing to the credit score the whole
 * platform is built on. A worker could pass CI forever and stay "no graded work
 * yet".
 *
 * Idempotent: webhooks are re-delivered, and check_suite and check_run can both
 * fire for one result, so the event id is derived from the job and skipped if
 * already present.
 */
async function recordCiCreditEvent(
  spec: typeof jobSpec.$inferSelect,
  passed: boolean,
  detail: Record<string, unknown>,
): Promise<void> {
  if (!spec.workerAgentId || spec.onchainJobId === null) return
  try {
    // Stamp the requester's current score for credibility weighting.
    if (spec.requesterAgentId && detail.requesterScore === undefined) {
      const { agent } = await import('@/lib/db/schema')
      const [req] = await db.select({ creditScore: agent.creditScore }).from(agent).where(eq(agent.id, spec.requesterAgentId))
      detail.requesterScore = req ? Number(req.creditScore) : null
    }
    const { agentEvent } = await import('@/lib/db/schema')
    const taskId = `job-${spec.onchainJobId}-ci`
    const existing = await db.select({ id: agentEvent.id }).from(agentEvent).where(eq(agentEvent.taskId, taskId))
    if (existing.length > 0) return

    const { nanoid } = await import('nanoid')
    await db.insert(agentEvent).values({
      id: nanoid(),
      agentId: spec.workerAgentId,
      taskId,
      eventType: passed ? 'JOB_TESTS_PASSED' : 'JOB_TESTS_FAILED',
      success: passed,
      executionTime: 0,
      tokenCost: 0,
      qualityScore: passed ? '1.000' : '0.000', // a graded fact, not self-assessment
      detail,
    })
    const { recalculateCredit } = await import('@/lib/credit-engine')
    await recalculateCredit(spec.workerAgentId)
  } catch (error) {
    console.error('[github/webhook] recording the CI credit event failed (non-fatal):', error)
  }
}

async function handleCheck(event: string, payload: any) {
  const repoFullName: string | undefined = payload?.repository?.full_name
  const node = event === 'check_suite' ? payload?.check_suite : payload?.check_run
  if (!repoFullName || payload?.action !== 'completed' || !node) return Response.json({ status: 'ignored' })

  // check_run carries its PRs on the run; check_suite on the suite.
  const prs: Array<{ number: number }> = node.pull_requests ?? node.check_suite?.pull_requests ?? []
  const conclusion: string = node.conclusion ?? ''
  if (!prs.length) return Response.json({ status: 'ignored', reason: 'no pull requests on this check' })

  let handled = 0
  for (const pr of prs) {
    const spec = await specForPr(repoFullName, pr.number)
    if (!spec) continue

    if (conclusion === 'success') {
      // Green CI is the independent verdict — recorded, and announced on the
      // PR — but the money waits for the merge.
      await writeVerdict(
        spec.specHash,
        {
          passed: true,
          output: `CI passed on ${repoFullName}#${pr.number} (${event} conclusion: success). The escrow releases when the requester merges.`,
          gradedAt: new Date().toISOString(),
        },
        'success',
      )
      const { commentOnPr } = await import('@/lib/github-app')
      await commentOnPr(
        repoFullName,
        pr.number,
        `✅ CI is green. Merging this pull request releases the escrowed bounty to the worker; closing it unmerged refunds it. ` +
          `— [Ledgermind](https://ai-agent-credit-dashboard.vercel.app) job #${spec.onchainJobId}`,
      )
      await recordCiCreditEvent(spec, true, {
        jobId: spec.onchainJobId,
        repo: repoFullName,
        prNumber: pr.number,
        grader: 'repo-ci',
        requesterAgentId: spec.requesterAgentId ?? null,
        conclusion,
      })
      const { logPlatformEvent } = await import('@/lib/platform-feed')
      await logPlatformEvent(
        'JOB_TESTS_PASSED',
        `"${spec.title}" — the repository's own CI passed on PR #${pr.number}; awaiting the requester's merge to release escrow`,
      ).catch(() => {})
      handled++
    } else if (conclusion === 'failure' || conclusion === 'timed_out') {
      // The requester's own grader failed the work: an objective verdict, so
      // the standard failure path runs — close the PR, refund, repost for a
      // different worker.
      await writeVerdict(
        spec.specHash,
        {
          passed: false,
          output: `CI failed on ${repoFullName}#${pr.number} (${event} conclusion: ${conclusion}). The repository's own checks are the grader for repo jobs.`,
          gradedAt: new Date().toISOString(),
        },
        'failure',
      )
      await recordCiCreditEvent(spec, false, {
        jobId: spec.onchainJobId,
        repo: repoFullName,
        prNumber: pr.number,
        grader: 'repo-ci',
        requesterAgentId: spec.requesterAgentId ?? null,
        conclusion,
      })
      const { commentOnPr } = await import('@/lib/github-app')
      await commentOnPr(
        repoFullName,
        pr.number,
        `❌ CI failed, so this attempt did not earn the bounty. The escrow is being refunded and the job reposted for a different worker.`,
      )
      const fresh = await specForPr(repoFullName, pr.number)
      const { returnFailedJobToMarket } = await import('@/lib/labor-settle')
      if (fresh) await returnFailedJobToMarket(fresh)
      handled++
    }
    // neutral / skipped / cancelled / action_required: not a verdict — ignore.
  }
  return Response.json({ status: 'ok', handled })
}

async function handlePullRequest(payload: any) {
  const repoFullName: string | undefined = payload?.repository?.full_name
  const prNumber: number | undefined = payload?.pull_request?.number
  if (!repoFullName || !prNumber || payload?.action !== 'closed') return Response.json({ status: 'ignored' })

  const spec = await specForPr(repoFullName, prNumber)
  if (!spec) return Response.json({ status: 'ignored', reason: 'no job for this PR' })

  const merged = Boolean(payload?.pull_request?.merged)
  const { logPlatformEvent } = await import('@/lib/platform-feed')

  if (merged) {
    // The requester merged: their own, first-party approval of this work.
    // Record it as the verdict (a merge outranks any grader) and release.
    await writeVerdict(
      spec.specHash,
      {
        passed: true,
        output: `The requester merged ${repoFullName}#${prNumber} — the work was accepted into the repository.`,
        gradedAt: new Date().toISOString(),
      },
      // Deliberately null: the merge is already recorded in testResult and in
      // the on-chain status. Writing 'merged' into ciStatus overwrote what CI
      // actually said, so a merged job reported "no CI result yet" — the audit
      // trail lost the verdict at the exact moment it mattered most.
      null,
    )
    const fresh = await specForPr(repoFullName, prNumber)
    const { autoApprovePassedJob } = await import('@/lib/labor-settle')
    if (fresh) await autoApprovePassedJob(fresh, { authorization: 'merge' })
    await logPlatformEvent(
      'REPO_JOB_MERGED',
      `"${spec.title}" — PR #${prNumber} merged on ${repoFullName}; escrow released to the worker`,
    ).catch(() => {})
    return Response.json({ status: 'ok', settled: 'merged' })
  }

  // Closed without merging = rejected. Same semantics as a failed grade.
  await writeVerdict(
    spec.specHash,
    {
      passed: false,
      output: `The requester closed ${repoFullName}#${prNumber} without merging — the work was not accepted.`,
      gradedAt: new Date().toISOString(),
    },
    'closed',
  )
  const fresh = await specForPr(repoFullName, prNumber)
  const { returnFailedJobToMarket } = await import('@/lib/labor-settle')
  if (fresh) await returnFailedJobToMarket(fresh)
  await logPlatformEvent(
    'REPO_JOB_REJECTED',
    `"${spec.title}" — PR #${prNumber} closed unmerged on ${repoFullName}; escrow refunded and the job reposted`,
  ).catch(() => {})
  return Response.json({ status: 'ok', settled: 'closed' })
}
