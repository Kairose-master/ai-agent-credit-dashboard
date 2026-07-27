/**
 * The shared guard for operator endpoints that MOVE MONEY.
 *
 * Two of them accepted `GET`, with a comment saying so on purpose: "allowed
 * too so it can be fired from a browser address bar with ?secret= during
 * testing." That convenience is a live trigger. A GET whose side effect is
 * escrowing bounties fires whenever anything **fetches the URL**, and URLs
 * with secrets in them travel: they get pasted into chat, and Slack, Discord,
 * iMessage and every other client unfurl links by fetching them. Paste
 * `…/post-image-jobs?secret=…&count=12` into a channel and the unfurl bot
 * escrows twelve bounties before anyone reads the message. I have pasted
 * admin URLs into chat in this very project.
 *
 * So: state-changing operator endpoints are POST-only. A GET answers 405
 * with the exact `curl` to run — the browser-address-bar workflow keeps its
 * discoverability and loses its ability to act by accident. Read-only
 * diagnostics (`/api/admin/health`, `job-diag`) stay on GET; nothing happens
 * when they're prefetched.
 *
 * The secret is still accepted from the query string, because breaking every
 * saved command would be worse than the exposure. But it is now flagged:
 * Vercel logs the full request path, so `?secret=` puts the operator secret
 * into log storage where it stays. The warning names that, once per call,
 * so it shows up the next time anyone reads the logs.
 */

export type AdminAuth = { ok: true } | { ok: false; response: Response }

/** How the operator should call a mutating endpoint, as copy-pasteable text. */
export function curlHint(request: Request): string {
  const url = new URL(request.url)
  url.searchParams.delete('secret')
  return `curl -X POST -H "Authorization: Bearer $CRON_SECRET" "${url.toString()}"`
}

/**
 * Shared-secret check for operator endpoints. Pass `mutating: true` for
 * anything with a side effect — it additionally refuses GET.
 */
export function requireOperator(request: Request, opts?: { mutating?: boolean }): AdminAuth {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return { ok: false, response: Response.json({ error: 'CRON_SECRET is not configured' }, { status: 503 }) }
  }

  if (opts?.mutating && request.method === 'GET') {
    return {
      ok: false,
      response: Response.json(
        {
          error: 'This endpoint changes state, so it is POST-only.',
          why: 'A GET that escrows money fires on any prefetch — including the link unfurl that happens when its URL is pasted into a chat.',
          run: curlHint(request),
        },
        { status: 405, headers: { Allow: 'POST' } },
      ),
    }
  }

  const url = new URL(request.url)
  const fromHeader = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const fromQuery = url.searchParams.get('secret')
  const given = fromHeader ?? fromQuery ?? ''
  if (given !== secret) {
    return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  if (!fromHeader && fromQuery) {
    console.warn(
      `[admin] ${url.pathname} was authorised with ?secret= in the URL. Vercel logs the full path, so the operator ` +
        'secret is now in log storage. Prefer: Authorization: Bearer $CRON_SECRET',
    )
  }
  return { ok: true }
}
