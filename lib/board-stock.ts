/**
 * Board restocking — a marketplace page must never open on an empty shelf.
 *
 * The faucet's synthetic exercises were retired as clutter, and every other
 * dogfood source (docs, test suites) posts each piece at most once — so the
 * board drains to zero between admin visits, and a first-time visitor lands
 * on "0 open jobs", which reads as "dead product" no matter how alive the
 * settlement history is.
 *
 * The renewable backlog is i18n: the shipped dictionary is missing hundreds
 * of keys across locales (`npm run i18n:check`), each chunk of which is a
 * real, LLM-graded, escrow-settled job whose passing result actually ships
 * to visitors (applyPassedI18nTranslations). This module gives the ops
 * heartbeat the same posting core the admin button uses, gated on the LIVE
 * open count — nothing posts while the shelf is stocked, so it converges
 * instead of flooding. No fake data: if the backlog is truly done someday,
 * the board is honestly quiet.
 */
import { db } from '@/lib/db'
import { agent, jobSpec } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  I18N_JOB_BOUNTY_USD,
  I18N_JOB_LOCALES,
  I18N_JOB_MIN_SCORE,
  chunkKeys,
  i18nJobAcceptanceCriteria,
  i18nJobDescription,
  i18nJobTitle,
  localeOfI18nJobTitle,
  missingKeysFor,
} from '@/lib/i18n-jobs'

/** Keep at least this many jobs Open on the public board. */
export const BOARD_TARGET_OPEN = 3
/** Never post more than this many per restock pass (cron runs often). */
const MAX_PER_PASS = 2
/** One locale never floods the board. */
const MAX_PER_LOCALE = 1

export type RestockReport = { posted: number; openBefore: number; skipped?: string }

/**
 * The shared posting core (used by the admin button and the cron): post up
 * to `maxJobs` i18n gap jobs, skipping locales that already have one Open.
 */
export async function postI18nGapJobsCore(
  houseAgentId: string,
  maxJobs: number,
  maxPerLocale: number = MAX_PER_LOCALE,
): Promise<{ posted: number; results: { title: string; ok: boolean; error?: string }[] }> {
  const { postJob } = await import('@/lib/onchain/labor')
  const { readJobsOrUnknown } = await import('@/lib/onchain/labor-read')
  const { keccak256, toHex } = await import('viem')

  const [existingJobs, existingSpecs] = await Promise.all([
    readJobsOrUnknown(),
    db.select().from(jobSpec).where(eq(jobSpec.requesterAgentId, houseAgentId)),
  ])
  // The Open set below is the only thing stopping a locale being posted twice.
  // Unknown chain state must not read as "no locale has an open job".
  if (existingJobs === null) {
    return { posted: 0, results: [{ title: '(all)', ok: false, error: 'chain read failed — refusing to post against unknown state' }] }
  }
  const specByHash = new Map(existingSpecs.map((s) => [s.specHash, s]))
  const localesWithOpenJob = new Set(
    existingJobs
      .filter((j) => j.status === 'Open')
      .map((j) => localeOfI18nJobTitle(specByHash.get(j.specHash)?.title ?? ''))
      .filter(Boolean),
  )

  // Pre-fund: a dry house wallet otherwise fails deep inside an ERC-4337
  // simulation with `USDC: balance`, which reads like an outage.
  const { ensureHouseFunds } = await import('@/lib/house-funding')
  await ensureHouseFunds(houseAgentId, maxJobs * I18N_JOB_BOUNTY_USD)

  const results: { title: string; ok: boolean; error?: string }[] = []
  let posted = 0

  for (const locale of I18N_JOB_LOCALES) {
    if (posted >= maxJobs) break
    if (localesWithOpenJob.has(locale)) continue
    const missing = missingKeysFor(locale)
    if (missing.length === 0) continue

    for (const keys of chunkKeys(missing).slice(0, maxPerLocale)) {
      if (posted >= maxJobs) break
      const title = i18nJobTitle(locale, keys)
      try {
        const specHash = keccak256(toHex(JSON.stringify({ title, agent: houseAgentId, nonce: nanoid() })))
        await db.insert(jobSpec).values({
          specHash,
          title,
          description: i18nJobDescription(locale, keys),
          acceptanceCriteria: i18nJobAcceptanceCriteria(locale, keys),
          requesterAgentId: houseAgentId,
          autoApprove: true, // LLM-graded text job; the house agent has no human approver
        })
        await postJob(houseAgentId, I18N_JOB_BOUNTY_USD, I18N_JOB_MIN_SCORE, specHash)
        results.push({ title, ok: true })
        posted++
      } catch (error) {
        const { explainOnchainError } = await import('@/lib/onchain/errors')
        results.push({ title, ok: false, error: explainOnchainError(error) })
      }
    }
  }

  if (posted > 0) {
    const { logPlatformEvent } = await import('@/lib/platform-feed')
    await logPlatformEvent('JOB_POSTED', `Posted ${posted} real i18n translation job(s) from the platform backlog`).catch(() => {})
  }
  return { posted, results }
}

/** Cron entry: top the board back up to BOARD_TARGET_OPEN when it drains. */
export async function restockBoard(target: number = BOARD_TARGET_OPEN): Promise<RestockReport> {
  const houseAgentId = process.env.X402_JOB_REQUESTER_AGENT_ID
  if (!houseAgentId) return { posted: 0, openBefore: 0, skipped: 'no house agent configured' }

  const { isLaborMarketConfigured } = await import('@/lib/onchain/config')
  if (!isLaborMarketConfigured()) return { posted: 0, openBefore: 0, skipped: 'labor market not configured' }

  const [house] = await db.select({ address: agent.smartAccountAddress }).from(agent).where(eq(agent.id, houseAgentId))
  if (!house?.address) return { posted: 0, openBefore: 0, skipped: 'house agent not provisioned' }

  // A failed chain read is NOT an empty board. This step runs on the
  // five-minute traffic tick, so swallowing the error meant a Sepolia hiccup
  // posted a fresh batch of escrowed jobs every tick it lasted.
  const { readJobsOrUnknown, countOpenBy } = await import('@/lib/onchain/labor-read')
  const openBefore = countOpenBy(await readJobsOrUnknown())
  if (openBefore === null) {
    return { posted: 0, openBefore: 0, skipped: 'chain read failed — refusing to restock against unknown state' }
  }
  if (openBefore >= target) return { posted: 0, openBefore }

  const need = Math.min(MAX_PER_PASS, target - openBefore)
  const { posted } = await postI18nGapJobsCore(houseAgentId, need)
  return { posted, openBefore }
}
