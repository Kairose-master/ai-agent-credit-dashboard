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

async function writeVerdict(specHash: string, verdict: Verdict, ciStatus: string) {
  await db.update(jobSpec).set({ testResult: verdict, ciStatus }).where(eq(jobSpec.specHash, specHash))
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
      'merged',
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
