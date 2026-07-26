'use server'

/**
 * Posting GitHub repo jobs (docs/github-jobs.md, Phase 2).
 *
 * Kept out of app/actions/labor.ts because a repo job has a real precondition
 * the generic Post-a-Job form doesn't: the platform's GitHub App must actually
 * be installed on the repository, and the base branch must exist. Both are
 * checked HERE, before any escrow moves — a requester finding out at
 * settlement time that we can't open a PR is the worst possible moment.
 */
import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent, jobSpec } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'
import { asActionError } from '@/lib/action-error'
import { logPlatformEvent } from '@/lib/platform-feed'
import {
  repoJobAcceptanceCriteria,
  repoJobDescription,
  repoJobTitle,
  validateRepoFullName,
} from '@/lib/repo-jobs'

export type RepoJobInput = {
  requesterAgentId: string
  repoFullName: string
  baseBranch?: string
  title: string
  brief: string
  issueUrl?: string
  criteria?: string
  bountyUsd: number
  minScore?: number
}

/** Dogfood path: post a repo job from the platform's own house requester, so
 *  the operator can put THIS repo's real backlog on the board (same principle
 *  as the i18n/docs/test-suite dogfood sources — real work, real escrow). */
export async function postRepoJobAsHouse(input: Omit<RepoJobInput, 'requesterAgentId'>) {
  const session = await getSession()
  const { isSuperAdminEmail } = await import('@/lib/admin')
  if (!isSuperAdminEmail(session?.user?.email)) throw new Error('Superadmin access required')
  const houseAgentId = process.env.X402_JOB_REQUESTER_AGENT_ID
  if (!houseAgentId) throw new Error('Set X402_JOB_REQUESTER_AGENT_ID (a provisioned, funded agent) first')
  const [house] = await db.select().from(agent).where(eq(agent.id, houseAgentId))
  if (!house?.smartAccountAddress) throw new Error('House requester agent is not provisioned')
  return postRepoJob({ ...input, requesterAgentId: houseAgentId })
}

/** Is the App installed and the branch real? Returns a human-readable reason
 *  when not, so the UI/MCP can tell the requester exactly what to fix. */
export async function checkRepoAccess(
  repoFullName: string,
): Promise<{ ok: boolean; reason: string; defaultBranch?: string }> {
  if (!validateRepoFullName(repoFullName)) return { ok: false, reason: 'Repository must be in owner/name form.' }
  const { isGithubAppConfigured, installationTokenForRepo, repoDefaultBranch } = await import('@/lib/github-app')
  if (!(await isGithubAppConfigured())) {
    return { ok: false, reason: 'This deployment has no GitHub App configured, so repo jobs are unavailable.' }
  }
  try {
    const token = await installationTokenForRepo(repoFullName)
    const defaultBranch = await repoDefaultBranch(repoFullName, token)
    return { ok: true, reason: `App installed on ${repoFullName} (default branch ${defaultBranch}).`, defaultBranch }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Post a repo job: escrow a bounty against a real repository issue/task. The
 * worker's deliverable is a unified diff; the platform opens the PR; the
 * repository's own CI grades it; merging releases the escrow.
 */
export async function postRepoJobAction(input: RepoJobInput) {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  const [ag] = await db.select().from(agent).where(eq(agent.id, input.requesterAgentId))
  if (!ag || ag.userId !== session.user.id) throw new Error('Agent not found')
  return postRepoJob(input)
}

/** The posting itself, with the caller's authorization already established.
 *  Never export-and-call this without an ownership or superadmin check. */
async function postRepoJob(input: RepoJobInput) {
  const [ag] = await db.select().from(agent).where(eq(agent.id, input.requesterAgentId))
  if (!ag) throw new Error('Agent not found')
  if (!ag.smartAccountAddress) throw new Error('Provision the requester agent first')

  const repoFullName = input.repoFullName.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')
  if (!validateRepoFullName(repoFullName)) throw new Error('Repository must be in owner/name form, e.g. acme/widgets')
  if (!input.title.trim()) throw new Error('Title required')
  if (input.brief.trim().length < 20) throw new Error('The task brief must be specific enough to work (20+ characters)')
  if (!Number.isFinite(input.bountyUsd) || input.bountyUsd <= 0) throw new Error('Bounty must be positive')

  const access = await checkRepoAccess(repoFullName)
  if (!access.ok) {
    throw new Error(
      `Cannot post a job on ${repoFullName}: ${access.reason} ` +
        'Install the Ledgermind GitHub App on the repository first — the platform needs it to open the pull request.',
    )
  }
  const baseBranch = input.baseBranch?.trim() || access.defaultBranch || 'main'

  try {
    const { keccak256, toHex } = await import('viem')
    const specHash = keccak256(
      toHex(JSON.stringify({ repo: repoFullName, title: input.title, agent: input.requesterAgentId, nonce: nanoid() })),
    )

    await db.insert(jobSpec).values({
      specHash,
      title: repoJobTitle(repoFullName, input.title),
      description: repoJobDescription({
        repoFullName,
        baseBranch,
        brief: input.brief,
        issueUrl: input.issueUrl || null,
      }),
      acceptanceCriteria: repoJobAcceptanceCriteria({ repoFullName, baseBranch, criteria: input.criteria }),
      requesterAgentId: input.requesterAgentId,
      repoFullName,
      baseBranch,
      // Merge is the release trigger for repo jobs regardless of this flag
      // (autoApprovePassedJob refuses to release a repo job on a grader
      // verdict), but keep it false so nothing about the intent is ambiguous.
      autoApprove: false,
      deliverableKind: 'text', // the diff IS text — no special worker capability needed
      requiredCapabilities: ['code'],
    })

    const { postJob } = await import('@/lib/onchain/labor')
    const txHash = await postJob(
      input.requesterAgentId,
      input.bountyUsd,
      Math.round(input.minScore ?? 0),
      specHash,
    )

    // Backfill the on-chain id so the webhook/settle paths can key off it.
    try {
      const { readJobs } = await import('@/lib/onchain/labor')
      const jobs = await readJobs({ maxAgeMs: 0 })
      const posted = jobs.find((j) => j.specHash.toLowerCase() === specHash.toLowerCase())
      if (posted) await db.update(jobSpec).set({ onchainJobId: posted.id }).where(eq(jobSpec.specHash, specHash))
    } catch (e) {
      console.error('[repo-jobs] onchainJobId backfill failed (non-fatal):', e)
    }

    await logPlatformEvent(
      'REPO_JOB_POSTED',
      `${ag.name} posted a GitHub job on ${repoFullName} — "${input.title}" ($${input.bountyUsd})`,
    )
    revalidatePath('/jobs')
    return { txHash, specHash, repoFullName, baseBranch }
  } catch (error) {
    throw asActionError(error, 'postRepoJobAction')
  }
}
