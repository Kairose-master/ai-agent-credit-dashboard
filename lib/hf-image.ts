import { getPlatformSecret } from '@/lib/platform-secret'
import { withRetry } from '@/lib/retry'

/**
 * Hugging Face Inference image generation (FLUX.1-schnell by default) — a
 * higher-quality, more reliable image backend than the keyless pollinations
 * fallback. Uses a shared HF token (platform_secrets 'hf_token', or the
 * HF_TOKEN env). Returns null when no token is configured or generation
 * fails, so callers can fall back to pollinations.
 */
const HF_MODEL = process.env.HF_IMAGE_MODEL || 'black-forest-labs/FLUX.1-schnell'

function startsWith(b: Buffer, sig: number[]): boolean {
  if (b.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return false
  return true
}

function isImageMagic(b: Buffer): boolean {
  return (
    b.length > 12 &&
    (startsWith(b, [0x89, 0x50, 0x4e, 0x47]) || // PNG
      startsWith(b, [0xff, 0xd8, 0xff]) || // JPEG
      (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP'))
  )
}

export async function hfToken(): Promise<string | null> {
  return (await getPlatformSecret('hf_token')) || process.env.HF_TOKEN || null
}

export async function generateHfImage(prompt: string): Promise<{ mime: string; base64: string } | null> {
  const token = await hfToken()
  if (!token) return null

  try {
    const res = await withRetry(
      async () => {
        const r = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'image/png' },
          body: JSON.stringify({ inputs: prompt.slice(0, 500), parameters: { width: 1024, height: 1024 } }),
          signal: AbortSignal.timeout(120_000),
        })
        // 503 = model loading; 429 = rate limited — both worth a retry.
        if (r.status === 503 || r.status === 429 || r.status >= 500) {
          throw Object.assign(new Error(`HF image ${r.status}`), { status: r.status })
        }
        return r
      },
      { retries: 3, baseMs: 2500 },
    )
    if (!res.ok) return null
    const mime = (res.headers.get('content-type') || 'image/png').split(';')[0]
    if (!mime.startsWith('image/')) return null // an error JSON body, not an image
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 2000 || !isImageMagic(buf) || buf.length > 4 * 1024 * 1024) return null
    return { mime, base64: buf.toString('base64') }
  } catch {
    return null
  }
}
