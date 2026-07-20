import { setFaucetOwnerAnthropicKey } from '@/lib/job-faucet'

/**
 * Attach an Anthropic key to the house faucet account so house-posted image
 * jobs can be vision-graded (and text jobs LLM-graded) without a per-requester
 * key. The key is read from the POST body — never the URL — so it does not
 * land in access logs, and it is stored encrypted (encryptSecret). The
 * response returns only the last 4 chars for confirmation.
 *
 * Auth: same shared secret as the settlement heartbeat —
 *   Authorization: Bearer <CRON_SECRET>   (or ?secret=<CRON_SECRET>)
 *
 * Usage:
 *   curl -X POST "https://<host>/api/admin/set-faucet-key?secret=$CRON_SECRET" \
 *     -H 'content-type: application/json' -d '{"key":"sk-ant-..."}'
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  }
  const url = new URL(request.url)
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('secret') ?? ''
  if (given !== secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let key = ''
  try {
    const body = await request.json()
    key = String(body?.key ?? '')
  } catch {
    return Response.json({ error: 'body must be JSON: {"key":"sk-ant-..."}' }, { status: 400 })
  }
  if (!key) return Response.json({ error: 'missing "key" in body' }, { status: 400 })

  try {
    const result = await setFaucetOwnerAnthropicKey(key)
    return Response.json({ status: 'ok', storedFor: 'faucet@ledgermind.internal', keyEndsWith: result.keyTail })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
