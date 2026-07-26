'use server'

/**
 * Board curation, admin-triggered. Two jobs:
 *
 *   • postDocsTranslationJobs — the second dogfood source: the repo's real
 *     documentation backlog (lib/docs-jobs.ts) as LLM-graded jobs. Files are
 *     read from the deployed bundle at post time (traced via
 *     outputFileTracingIncludes), chunked by whole ## sections.
 *
 *   • cancelPracticeJobs — the un-clutter sweep: cancels every Open job owned
 *     by the house/faucet agents that is NOT dogfood work (i18n/docs
 *     prefixes), refunding each escrow to its poster on-chain. The practice
 *     catalog (seed exercises, faucet templates) stops reading as the
 *     platform's demand; the faucet itself is opt-in now (FAUCET_ENABLED).
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getSession } from '@/lib/get-session'
import { isSuperAdminEmail } from '@/lib/admin'
import { db } from '@/lib/db'
import { agent, jobSpec } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { revalidatePath } from 'next/cache'
import { logPlatformEvent } from '@/lib/platform-feed'
import { asActionError } from '@/lib/action-error'
import {
  DOCS_JOB_BOUNTY_USD,
  DOCS_JOB_MIN_SCORE,
  DOCS_JOB_SOURCES,
  docsJobAcceptanceCriteria,
  docsJobDescription,
  docsJobTitle,
  isDogfoodJobTitle,
  splitMarkdownSections,
} from '@/lib/docs-jobs'

const MAX_DOCS_JOBS_PER_CLICK = 4

async function requireSuperAdmin() {
  const session = await getSession()
  if (!isSuperAdminEmail(session?.user?.email)) throw new Error('Superadmin access required')
}

async function houseContext() {
  const houseAgentId = process.env.X402_JOB_REQUESTER_AGENT_ID
  if (!houseAgentId) throw new Error('Set X402_JOB_REQUESTER_AGENT_ID (a provisioned, funded agent) first')
  const [house] = await db.select().from(agent).where(eq(agent.id, houseAgentId))
  if (!house?.smartAccountAddress) throw new Error('House requester agent is not provisioned')
  const { isLaborMarketConfigured } = await import('@/lib/onchain/config')
  if (!isLaborMarketConfigured()) throw new Error('Labor market is not configured on this deployment')
  return houseAgentId
}

/** What the house requester wallet holds right now — the number that decides
 *  whether any posting button can work at all. */
export async function getHouseWalletStatus() {
  await requireSuperAdmin()
  const houseAgentId = process.env.X402_JOB_REQUESTER_AGENT_ID
  if (!houseAgentId) return { configured: false as const, address: null, balanceUsd: null }
  const { houseBalanceUsd } = await import('@/lib/house-funding')
  const { address, balanceUsd } = await houseBalanceUsd(houseAgentId)
  return { configured: true as const, address, balanceUsd }
}

/** Mint free testnet MockUSDC into the house requester wallet. The contract
 *  is openly mintable on testnet by design, so this costs nothing and needs
 *  no approval — it exists as a button because an empty house wallet is the
 *  single most common reason a posting click fails. */
export async function topUpHouseWallet(amountUsd = 100) {
  await requireSuperAdmin()
  const houseAgentId = await houseContext()
  const { houseBalanceUsd } = await import('@/lib/house-funding')
  const { address } = await houseBalanceUsd(houseAgentId)
  if (!address) throw new Error('House requester agent has no wallet')
  const amount = Math.max(1, Math.min(Math.round(amountUsd), 5000))
  try {
    const { mintTestUsdc } = await import('@/lib/onchain/treasury')
    await mintTestUsdc(houseAgentId, amount, address as `0x${string}`)
  } catch (error) {
    throw asActionError(error, 'topUpHouseWallet')
  }
  const after = await houseBalanceUsd(houseAgentId)
  await logPlatformEvent('HOUSE_WALLET_TOPPED_UP', `House requester topped up with $${amount} test USDC`)
  return { minted: amount, balanceUsd: after.balanceUsd }
}

export async function postDocsTranslationJobs() {
  await requireSuperAdmin()
  const houseAgentId = await houseContext()

  const { readJobs, postJob } = await import('@/lib/onchain/labor')
  const { keccak256, toHex } = await import('viem')

  const [existingJobs, existingSpecs] = await Promise.all([
    readJobs().catch(() => []),
    db.select().from(jobSpec).where(eq(jobSpec.requesterAgentId, houseAgentId)),
  ])
  const specByHash = new Map(existingSpecs.map((s) => [s.specHash, s]))
  const openTitles = new Set(
    existingJobs
      .filter((j) => j.status === 'Open')
      .map((j) => specByHash.get(j.specHash)?.title)
      .filter(Boolean),
  )
  // A docs title ever posted (any status) is done or in flight — don't repost
  // the same part when it completes; the operator commits the result instead.
  const everPosted = new Set(existingSpecs.map((s) => s.title))

  // Pre-fund: a dry house wallet otherwise fails every post deep inside an
  // ERC-4337 simulation with `USDC: balance`, which reads like an outage.
  const { ensureHouseFunds } = await import('@/lib/house-funding')
  const funding = await ensureHouseFunds(houseAgentId, MAX_DOCS_JOBS_PER_CLICK * DOCS_JOB_BOUNTY_USD)

  const results: { title: string; ok: boolean; skipped?: boolean; error?: string }[] = []
  let posted = 0

  for (const source of DOCS_JOB_SOURCES) {
    if (posted >= MAX_DOCS_JOBS_PER_CLICK) break
    let md: string
    try {
      md = await readFile(join(process.cwd(), source.path), 'utf8')
    } catch {
      results.push({ title: source.path, ok: false, error: 'source file not readable in this deployment' })
      continue
    }
    const chunks = splitMarkdownSections(md)
    for (let i = 0; i < chunks.length; i++) {
      if (posted >= MAX_DOCS_JOBS_PER_CLICK) break
      const title = docsJobTitle(source, i + 1, chunks.length)
      if (openTitles.has(title) || everPosted.has(title)) {
        results.push({ title, ok: true, skipped: true })
        continue
      }
      try {
        const specHash = keccak256(toHex(JSON.stringify({ title, agent: houseAgentId, nonce: nanoid() })))
        await db.insert(jobSpec).values({
          specHash,
          title,
          description: docsJobDescription(source, chunks[i]!, i + 1, chunks.length),
          acceptanceCriteria: docsJobAcceptanceCriteria(source),
          requesterAgentId: houseAgentId,
          autoApprove: true,
        })
        await postJob(houseAgentId, DOCS_JOB_BOUNTY_USD, DOCS_JOB_MIN_SCORE, specHash)
        results.push({ title, ok: true })
        posted++
      } catch (error) {
        const { explainOnchainError } = await import('@/lib/onchain/errors')
        results.push({ title, ok: false, error: explainOnchainError(error) })
      }
    }
  }

  if (posted > 0) {
    await logPlatformEvent('JOB_POSTED', `Posted ${posted} real documentation job(s) from the platform backlog`)
  }
  revalidatePath('/jobs')
  return { posted, results, funding: funding.note }
}

/** Post the test-suite-writing jobs (mutation-graded — lib/test-suite-jobs.ts).
 *  Each catalog entry posts at most once ever: a winning suite becomes a
 *  verified template, so reposting the same contract would be duplicate work. */
export async function postTestSuiteJobs() {
  await requireSuperAdmin()
  const houseAgentId = await houseContext()

  const { TEST_SUITE_CATALOG, TESTS_JOB_BOUNTY_USD, TESTS_JOB_MIN_SCORE, testSuiteJobTitle, testSuiteJobDescription, testSuiteJobAcceptanceCriteria } =
    await import('@/lib/test-suite-jobs')
  const { postJob } = await import('@/lib/onchain/labor')
  const { keccak256, toHex } = await import('viem')

  const existingSpecs = await db.select().from(jobSpec).where(eq(jobSpec.requesterAgentId, houseAgentId))
  const everPosted = new Set(existingSpecs.map((s) => s.title))

  const { ensureHouseFunds } = await import('@/lib/house-funding')
  const pending = TEST_SUITE_CATALOG.filter((s) => !everPosted.has(testSuiteJobTitle(s))).length
  const funding = await ensureHouseFunds(houseAgentId, pending * TESTS_JOB_BOUNTY_USD)

  const results: { title: string; ok: boolean; skipped?: boolean; error?: string }[] = []
  let posted = 0

  for (const suite of TEST_SUITE_CATALOG) {
    const title = testSuiteJobTitle(suite)
    if (everPosted.has(title)) {
      results.push({ title, ok: true, skipped: true })
      continue
    }
    try {
      const specHash = keccak256(toHex(JSON.stringify({ title, agent: houseAgentId, nonce: nanoid() })))
      await db.insert(jobSpec).values({
        specHash,
        title,
        description: testSuiteJobDescription(suite),
        acceptanceCriteria: testSuiteJobAcceptanceCriteria(suite),
        requesterAgentId: houseAgentId,
        autoApprove: true, // mutation grading is mechanical — pass releases escrow
      })
      await postJob(houseAgentId, TESTS_JOB_BOUNTY_USD, TESTS_JOB_MIN_SCORE, specHash)
      results.push({ title, ok: true })
      posted++
    } catch (error) {
      const { explainOnchainError } = await import('@/lib/onchain/errors')
      results.push({ title, ok: false, error: explainOnchainError(error) })
    }
  }

  if (posted > 0) {
    await logPlatformEvent('JOB_POSTED', `Posted ${posted} mutation-graded test-suite job(s) from the platform backlog`)
  }
  revalidatePath('/jobs')
  return { posted, results, funding: funding.note }
}

/** Cancel every Open practice job (house/faucet-owned, non-dogfood title).
 *  Escrow refunds on-chain to the posting agent. Dogfood jobs are untouched. */
export async function cancelPracticeJobs() {
  await requireSuperAdmin()

  const houseAgentId = process.env.X402_JOB_REQUESTER_AGENT_ID ?? null
  const { faucetAgentId } = await import('@/lib/job-faucet')
  const faucetId = await faucetAgentId().catch(() => null)
  const platformIds = new Set([houseAgentId, faucetId].filter((x): x is string => Boolean(x)))
  if (platformIds.size === 0) throw new Error('No house/faucet agent configured — nothing to sweep')

  const { isLaborMarketConfigured } = await import('@/lib/onchain/config')
  if (!isLaborMarketConfigured()) throw new Error('Labor market is not configured on this deployment')

  const { readJobs, cancelJob } = await import('@/lib/onchain/labor')
  const jobs = await readJobs().catch(() => [])
  const specs = await db.select().from(jobSpec)
  const specByHash = new Map(specs.map((s) => [s.specHash, s]))
  const targets = jobs.filter((j) => {
    if (j.status !== 'Open') return false
    const spec = specByHash.get(j.specHash)
    if (!spec?.requesterAgentId || !platformIds.has(spec.requesterAgentId)) return false
    return !isDogfoodJobTitle(spec.title)
  })

  const results: { id: number; title: string; ok: boolean; error?: string }[] = []
  for (const j of targets) {
    const spec = specByHash.get(j.specHash)!
    try {
      await cancelJob(spec.requesterAgentId!, j.id)
      results.push({ id: j.id, title: spec.title, ok: true })
    } catch (error) {
      results.push({ id: j.id, title: spec.title, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const cancelled = results.filter((r) => r.ok).length
  if (cancelled > 0) {
    await logPlatformEvent('JOB_POSTED', `Cleared ${cancelled} practice job(s) from the board (escrow refunded)`)
  }
  revalidatePath('/jobs')
  return { cancelled, attempted: targets.length, results }
}
