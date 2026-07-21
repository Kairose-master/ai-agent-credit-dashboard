import { getPlatformSecret } from '@/lib/platform-secret'

/**
 * TEMPORARY diagnostic: probe candidate Hugging Face (fal-ai provider) TTS
 * endpoints/bodies server-side using the stored hf_token, and report each
 * one's HTTP status + a short response snippet so we can confirm the exact
 * schema before wiring the real generator. Guarded by CRON_SECRET. Delete
 * once the audio backend is settled.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CANDIDATES: { url: string; body: unknown }[] = [
  { url: 'https://router.huggingface.co/fal-ai/fal-ai/kokoro/american-english', body: { prompt: 'Hello from Ledgermind, testing text to speech.', voice: 'af_heart' } },
  { url: 'https://router.huggingface.co/fal-ai/fal-ai/kokoro', body: { prompt: 'Hello from Ledgermind, testing text to speech.', voice: 'af_heart' } },
  { url: 'https://router.huggingface.co/fal-ai/fal-ai/playai/tts/v3', body: { input: 'Hello from Ledgermind, testing text to speech.', voice: 'Jennifer (English (US)/American)' } },
  { url: 'https://router.huggingface.co/fal-ai/fal-ai/orpheus-tts', body: { text: 'Hello from Ledgermind, testing text to speech.' } },
]

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const url = new URL(request.url)
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('secret') ?? ''
  if (given !== secret) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const token = (await getPlatformSecret('hf_token')) || process.env.HF_TOKEN
  if (!token) return Response.json({ error: 'no hf_token stored' }, { status: 400 })

  const results = []
  for (const c of CANDIDATES) {
    try {
      const r = await fetch(c.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(c.body),
        signal: AbortSignal.timeout(45_000),
      })
      const ct = r.headers.get('content-type') ?? ''
      let snippet: string
      if (ct.includes('application/json')) {
        snippet = JSON.stringify(await r.json().catch(() => null)).slice(0, 500)
      } else {
        const buf = Buffer.from(await r.arrayBuffer())
        snippet = `<binary ${ct} ${buf.length} bytes, magic=${buf.subarray(0, 4).toString('hex')}>`
      }
      results.push({ url: c.url, status: r.status, contentType: ct, snippet })
    } catch (e) {
      results.push({ url: c.url, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return Response.json({ results })
}
