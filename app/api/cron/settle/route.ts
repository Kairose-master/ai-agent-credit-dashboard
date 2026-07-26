import { db } from '@/lib/db'
import { delegation } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { tickDelegation } from '@/lib/delegation'

export const maxDuration = 300 // settlement = several on-chain txs, LLM verify calls

/**
 * GET /api/cron/settle — the platform's background settlement heartbeat.
 *
 * Historically every verification/finalization tick piggybacked on a
 * human polling a page ("no-cron" design). That works until the human
 * closes the tab: Submitted jobs then sit ungraded and the UI falls back
 * to manual approve/dispute buttons. This endpoint IS that missing
 * heartbeat, callable by any scheduler:
 *
 *  - GitHub Actions (.github/workflows/settle-heartbeat.yml) every ~5 min — free
 *  - Vercel Cron (vercel.json) — daily on Hobby, per-minute on Pro
 *
 * It runs the exact same two sweeps the pages run, for ALL users:
 *  1. sweepStuckGradedJobs — re-drives settlements that died mid-flight
 *  2. tickDelegation for every active delegation — verifies submissions,
 *     pays passes, reposts failures, assembles finished delegations
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (or ?secret= for schedulers
 * that can't set headers). With CRON_SECRET unset the endpoint refuses to
 * run — never deploy an open settlement trigger.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  }
  const url = new URL(request.url)
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('secret') ?? ''
  if (given !== secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const report: Record<string, unknown> = {}

  const { sweepStuckGradedJobs, sweepDisputedJobs } = await import('@/lib/labor-settle')
  await sweepStuckGradedJobs()
    .then(() => { report.sweep = 'ok' })
    .catch((e) => { report.sweep = String(e) })

  // Return jobs stuck in dispute to the market so a different worker can take
  // them instead of the delegation waiting on them forever.
  await sweepDisputedJobs()
    .then((n) => { report.disputedReposted = n })
    .catch((e) => { report.disputedReposted = String(e) })

  // Walk unclaimed rising-price jobs toward their ceiling. Only ever touches
  // jobs still Open, so it can never cancel work somebody has started.
  const { sweepPriceRaises } = await import('@/lib/price-raise')
  await sweepPriceRaises()
    .then((n) => { report.pricesRaised = n })
    .catch((e) => { report.pricesRaised = String(e) })

  // Loans past due + grace become real defaults: status flip, the
  // REPAYMENT_DEFAULTED event, and the score hit it was designed to cause.
  const { sweepDefaultedLoans } = await import('@/lib/loan-sweep')
  await sweepDefaultedLoans()
    .then((n) => { report.loansDefaulted = n })
    .catch((e) => { report.loansDefaulted = String(e) })

  let active: (typeof delegation.$inferSelect)[] = []
  try {
    active = await db.select().from(delegation).where(eq(delegation.status, 'posted'))
  } catch {
    report.delegations = 'table missing (migration pending)'
  }

  if (active.length > 0) {
    const { readJobs } = await import('@/lib/onchain/labor')
    const jobs = await readJobs().catch(() => [])
    let ticked = 0
    let failed = 0
    for (const row of active) {
      await tickDelegation(row, jobs)
        .then(() => { ticked++ })
        .catch((e) => {
          failed++
          console.error(`[cron/settle] tick failed for ${row.id}:`, e)
        })
    }
    report.delegations = { active: active.length, ticked, failed }
  } else if (!report.delegations) {
    report.delegations = { active: 0 }
  }

  // Keep the starter-job supply topped up — the heartbeat is exactly the
  // "nobody is around" moment the faucet exists for.
  try {
    const { tickJobFaucet } = await import('@/lib/job-faucet')
    report.faucet = await tickJobFaucet({ force: true })
  } catch (e) {
    report.faucet = String(e)
  }

  // Drive cloud auto-mine agents from the heartbeat too. A cloud agent never
  // polls (the platform dispatches TO it), so without this it only mined when
  // a human happened to load a page. Now it self-ticks every heartbeat — the
  // sweep fans out across agents in bounded parallel (phase 1); each is a
  // distinct smart account, so their on-chain accepts are nonce-safe.
  try {
    const { tickCloudAutoMineAgents } = await import('@/lib/auto-mine')
    const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host
    await tickCloudAutoMineAgents(`${proto}://${host}/api/runtime/callback`)
    report.cloudMining = 'ok'
  } catch (e) {
    report.cloudMining = String(e)
  }

  // Let trusted agents cast their owners' governance votes on open
  // proposals. Best-effort (LLM-backed); never fails the heartbeat.
  try {
    const { runAutoVotes } = await import('@/lib/governance')
    report.autoVotes = await runAutoVotes()
  } catch (e) {
    report.autoVotes = String(e)
  }

  // Reveal any on-chain commit-reveal votes whose reveal window has opened
  // (no-op unless VEILPOLL_FACTORY_ADDRESS is configured).
  try {
    const { revealOnchainVotes } = await import('@/lib/governance')
    report.onchainReveals = await revealOnchainVotes()
  } catch (e) {
    report.onchainReveals = String(e)
  }

  return Response.json({ ok: true, ...report })
}
