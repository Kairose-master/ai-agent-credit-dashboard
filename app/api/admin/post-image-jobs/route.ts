import { postHouseImageJobs } from '@/lib/job-faucet'

/**
 * Post a handful of vision-graded image jobs from the house faucet wallet,
 * on demand. This is the "give me some image work to mine right now" button
 * for testing the image lane end-to-end (generate → vision grade → pay/refund).
 *
 * Auth: same shared secret as the settlement heartbeat —
 *   Authorization: Bearer <CRON_SECRET>   (or ?secret=<CRON_SECRET>)
 * With CRON_SECRET unset the endpoint refuses, so it can never post money
 * moves from an unauthenticated call.
 *
 * Usage:
 *   curl -X POST "https://<host>/api/admin/post-image-jobs?secret=$CRON_SECRET&count=3"
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  }
  const url = new URL(request.url)
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('secret') ?? ''
  if (given !== secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const count = Math.max(1, Math.min(Number(url.searchParams.get('count') ?? 3) || 3, 12))
  try {
    const report = await postHouseImageJobs(count)
    return Response.json({ status: 'ok', ...report })
  } catch (error) {
    console.error('[admin/post-image-jobs] failed:', error)
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

// POST is the real entrypoint; GET is allowed too so it can be fired from a
// browser address bar with ?secret= during testing.
export const POST = handle
export const GET = handle
