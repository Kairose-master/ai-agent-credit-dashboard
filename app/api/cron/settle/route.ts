import { runOpsCycle } from '@/lib/ops-cycle'

export const maxDuration = 300 // settlement = several on-chain txs, LLM verify calls

/**
 * GET /api/cron/settle — the platform's background settlement heartbeat.
 *
 * Historically every verification/finalization tick piggybacked on a human
 * polling a page ("no-cron" design). That works until the human closes the
 * tab: Submitted jobs then sit ungraded and the UI falls back to manual
 * approve/dispute buttons. This endpoint is the scheduler-callable version:
 *
 *  - GitHub Actions (.github/workflows/settle-heartbeat.yml) — free, but
 *    measured at 80–100 min against a requested 5, so it is a floor on
 *    freshness, not a guarantee
 *  - Vercel Cron (vercel.json) — daily on Hobby, per-minute on Pro
 *
 * The sweeps themselves live in lib/ops-cycle.ts, because ordinary traffic
 * drives the latency-critical subset of the same list (see
 * maybeRunTrafficTick) — one definition, no drift between "what the cron
 * runs" and "what a page load runs".
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

  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host
  const report = await runOpsCycle(`${proto}://${host}`)

  return Response.json({ ok: true, ...report })
}
