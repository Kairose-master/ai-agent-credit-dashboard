import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { curlHint, requireOperator } from '@/lib/admin-route'

const req = (url: string, init?: RequestInit) => new Request(url, init)
const BASE = 'https://example.test/api/admin/post-image-jobs'

afterEach(() => {
  delete process.env.CRON_SECRET
})

describe('requireOperator', () => {
  it('refuses everything when no secret is configured', async () => {
    const auth = requireOperator(req(BASE, { method: 'POST' }), { mutating: true })
    expect(auth.ok).toBe(false)
    if (!auth.ok) expect(auth.response.status).toBe(503)
  })

  it('refuses GET on a state-changing endpoint, even with the right secret', async () => {
    process.env.CRON_SECRET = 's3cret'
    // This is the whole point: a GET side effect fires on any prefetch, and a
    // URL carrying ?secret= is exactly the kind that gets pasted into chat,
    // where link unfurlers fetch it.
    const auth = requireOperator(req(`${BASE}?secret=s3cret&count=12`), { mutating: true })
    expect(auth.ok).toBe(false)
    if (!auth.ok) {
      expect(auth.response.status).toBe(405)
      expect(auth.response.headers.get('Allow')).toBe('POST')
      const body = await auth.response.json()
      expect(body.run).toContain('curl -X POST')
    }
  })

  it('allows GET on a read-only endpoint', () => {
    process.env.CRON_SECRET = 's3cret'
    expect(requireOperator(req(`${BASE}?secret=s3cret`)).ok).toBe(true)
  })

  it('accepts the secret from the Authorization header', () => {
    process.env.CRON_SECRET = 's3cret'
    const auth = requireOperator(
      req(BASE, { method: 'POST', headers: { authorization: 'Bearer s3cret' } }),
      { mutating: true },
    )
    expect(auth.ok).toBe(true)
  })

  it('still accepts the secret from the query string, for saved commands', () => {
    process.env.CRON_SECRET = 's3cret'
    expect(requireOperator(req(`${BASE}?secret=s3cret`, { method: 'POST' }), { mutating: true }).ok).toBe(true)
  })

  it('rejects a wrong secret', () => {
    process.env.CRON_SECRET = 's3cret'
    const auth = requireOperator(req(`${BASE}?secret=nope`, { method: 'POST' }), { mutating: true })
    expect(auth.ok).toBe(false)
    if (!auth.ok) expect(auth.response.status).toBe(401)
  })

  it('checks the method before the secret, so the 405 hint is reachable', () => {
    process.env.CRON_SECRET = 's3cret'
    // Someone whose saved URL has a stale secret should still be told the
    // real problem (GET), not sent chasing a 401.
    const auth = requireOperator(req(`${BASE}?secret=stale`), { mutating: true })
    expect(auth.ok).toBe(false)
    if (!auth.ok) expect(auth.response.status).toBe(405)
  })
})

describe('curlHint', () => {
  it('never echoes the secret back', () => {
    expect(curlHint(req(`${BASE}?secret=s3cret&count=3`))).not.toContain('s3cret')
  })

  it('keeps the other parameters so the command actually works', () => {
    const hint = curlHint(req(`${BASE}?secret=s3cret&count=3&kind=audio`))
    expect(hint).toContain('count=3')
    expect(hint).toContain('kind=audio')
    expect(hint).toContain('Authorization: Bearer $CRON_SECRET')
  })
})

describe('operator endpoints all go through the guard', () => {
  const ROOT = join(import.meta.dirname, '..')
  it('no route hand-rolls the shared-secret comparison any more', () => {
    const files = [
      'app/api/admin/post-image-jobs/route.ts',
      'app/api/admin/demo-negotiation/route.ts',
      'app/api/admin/resolve-stuck-job/route.ts',
      'app/api/admin/work-audio-job/route.ts',
      'app/api/admin/work-image-job/route.ts',
      'app/api/admin/set-faucet-key/route.ts',
      'app/api/admin/job-diag/route.ts',
      'app/api/admin/minivault/route.ts',
      'app/api/cron/settle/route.ts',
    ]
    for (const f of files) {
      const src = readFileSync(join(ROOT, f), 'utf8')
      expect(src, f).toContain('requireOperator')
      expect(src, f).not.toMatch(/given !== secret/)
    }
  })
})
