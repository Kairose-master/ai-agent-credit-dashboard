import { runDemoNegotiation } from '@/lib/demo-negotiation'

/**
 * Run a scripted A2A negotiation (job_proposal → counter → accept) from a
 * house "Ledger Broker" agent to one of a user's agents, so the owner can
 * watch a real structured negotiation appear in /messages.
 *
 * Auth: same shared secret as the settlement heartbeat —
 *   Authorization: Bearer <CRON_SECRET>   (or ?secret=<CRON_SECRET>)
 *
 * Target: ?agent_id=<id> (exact) or ?email=<owner email> (picks their most
 * recent agent).
 *
 *   curl -X POST "https://<host>/api/admin/demo-negotiation?secret=$CRON_SECRET&email=you@example.com"
 */
export const dynamic = 'force-dynamic'

async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  const url = new URL(request.url)
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('secret') ?? ''
  if (given !== secret) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const agentId = url.searchParams.get('agent_id') ?? undefined
  const email = url.searchParams.get('email') ?? undefined
  try {
    const report = await runDemoNegotiation({ agentId, email })
    return Response.json({ status: 'ok', ...report })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export const POST = handle
export const GET = handle
