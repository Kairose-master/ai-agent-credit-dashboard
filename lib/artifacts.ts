/**
 * Submission artifacts — validation and shared helpers for binary
 * deliverables (images/files) attached to task results.
 *
 * Limits are deliberately testnet-scale: artifacts live inline in Postgres
 * (base64), so a submission is bounded hard before anything is stored.
 */

export const MAX_ARTIFACTS_PER_SUBMISSION = 4
export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 // 2MB decoded

export const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf', 'text/', 'application/json', 'application/zip']

export interface IncomingArtifact {
  name: string
  mime: string
  dataBase64: string
  size: number
}

/** Parse + bound the `artifacts` field of a callback body. Throws with a
 *  worker-actionable message on any violation — a rejected artifact set
 *  rejects the whole submission, never silently drops files. */
export function validateArtifacts(raw: unknown): IncomingArtifact[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new Error('artifacts must be an array')
  if (raw.length > MAX_ARTIFACTS_PER_SUBMISSION) {
    throw new Error(`too many artifacts (max ${MAX_ARTIFACTS_PER_SUBMISSION} per submission)`)
  }

  return raw.map((a: any, i: number) => {
    const mime = String(a?.mime ?? '').toLowerCase().trim()
    const data = String(a?.data_base64 ?? a?.dataBase64 ?? '')
    if (!mime || !ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))) {
      throw new Error(`artifact ${i + 1}: unsupported mime type "${mime}"`)
    }
    if (!data || !/^[A-Za-z0-9+/=\s]+$/.test(data)) {
      throw new Error(`artifact ${i + 1}: data_base64 missing or not base64`)
    }
    const size = Math.floor((data.replace(/\s/g, '').length * 3) / 4)
    if (size > MAX_ARTIFACT_BYTES) {
      throw new Error(`artifact ${i + 1}: ${Math.round(size / 1024)}KB exceeds the ${MAX_ARTIFACT_BYTES / 1024 / 1024}MB limit`)
    }
    const name = String(a?.name ?? '').slice(0, 120) || `artifact-${i + 1}`
    return { name, mime, dataBase64: data.replace(/\s/g, ''), size }
  })
}

export const DELIVERABLE_KINDS = ['text', 'image', 'file'] as const
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number]

export function normalizeDeliverableKind(raw: unknown): DeliverableKind {
  const v = String(raw ?? 'text').toLowerCase()
  return (DELIVERABLE_KINDS as readonly string[]).includes(v) ? (v as DeliverableKind) : 'text'
}

/** Can a worker with `capabilities` take a job demanding `kind`? Agents
 *  registered before capabilities existed have null/empty — treat as
 *  text-only, the universal baseline. */
export function workerCanDeliver(capabilities: unknown, kind: string): boolean {
  const caps = Array.isArray(capabilities) && capabilities.length > 0 ? capabilities.map(String) : ['text']
  return caps.includes(kind)
}
