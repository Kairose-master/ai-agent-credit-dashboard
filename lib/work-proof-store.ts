import { pool } from '@/lib/db'
import { contentHashOf, signWorkProof, trustedAttester, WORK_PROOF_SCHEMA, type WorkProof } from '@/lib/attestation'
import { cidOfJson, pinBytes } from '@/lib/ipfs'

/**
 * Persistence + issuance for Proof of Authorship & Grade. Self-migrating: the
 * table is created on first use so it ships without a separate migration.
 *
 * Every row is a gas-free, independently verifiable certificate that a specific
 * deliverable (by keccak256 fingerprint) was produced by a worker for a job and
 * passed grading — signed by the platform oracle (the trusted attester).
 */
export interface StoredProof {
  id: string
  proof: WorkProof
  signature: string
  attester: string
  /** Content-addressed id (CIDv1) of the {proof, signature, attester} record —
   *  an ipfs:// identity that resolves on any gateway once pinned. */
  cid: string | null
}

async function ensureTable(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS work_proofs (
       id text PRIMARY KEY,
       job_ref text NOT NULL,
       content_hash text NOT NULL,
       attester text NOT NULL,
       signature text NOT NULL,
       proof jsonb NOT NULL,
       cid text,
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
  )
  await pool.query(`CREATE INDEX IF NOT EXISTS work_proofs_job_ref_idx ON work_proofs (job_ref)`)
  // Additive migration for tables created before the cid column existed.
  await pool.query(`ALTER TABLE work_proofs ADD COLUMN IF NOT EXISTS cid text`)
}

/**
 * Build → sign → store a proof for a graded-pass deliverable. Best-effort: any
 * failure (no oracle key, DB down) returns null instead of throwing, so proof
 * issuance never blocks settlement. `verdict` should already be a pass.
 */
export async function issueWorkProof(input: {
  jobRef: string
  kind: string
  worker: string
  requester: string
  grader: string
  deliverable: { base64?: string | null; dataUrl?: string | null; text?: string | null }
  gradedAt?: number
}): Promise<StoredProof | null> {
  try {
    const proof: WorkProof = {
      schema: WORK_PROOF_SCHEMA,
      jobRef: input.jobRef,
      kind: input.kind,
      contentHash: contentHashOf(input.deliverable),
      worker: input.worker,
      requester: input.requester,
      verdict: 'pass',
      grader: input.grader,
      gradedAt: input.gradedAt ?? Math.floor(Date.now() / 1000),
    }
    const signed = await signWorkProof(proof)
    if (!signed) return null

    // Content-address the whole signed record (IPFS + ENS pattern). The CID is
    // derived locally with no deps; pinning is best-effort (only if configured).
    const record = { proof, signature: signed.signature, attester: signed.attester }
    const cid = cidOfJson(record)
    void pinBytes(Buffer.from(JSON.stringify(record), 'utf8')) // fire-and-forget

    const id = crypto.randomUUID()
    await ensureTable()
    await pool.query(
      `INSERT INTO work_proofs (id, job_ref, content_hash, attester, signature, proof, cid)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, proof.jobRef, proof.contentHash, signed.attester, signed.signature, JSON.stringify(proof), cid],
    )
    return { id, proof, signature: signed.signature, attester: signed.attester, cid }
  } catch {
    return null
  }
}

export async function getWorkProof(id: string): Promise<StoredProof | null> {
  try {
    await ensureTable()
    const { rows } = await pool.query<{ id: string; proof: WorkProof; signature: string; attester: string; cid: string | null }>(
      `SELECT id, proof, signature, attester, cid FROM work_proofs WHERE id = $1`,
      [id],
    )
    if (!rows[0]) return null
    return { id: rows[0].id, proof: rows[0].proof, signature: rows[0].signature, attester: rows[0].attester, cid: rows[0].cid ?? null }
  } catch {
    return null
  }
}

/** Latest proof for a job reference (jobs can be re-graded / re-posted). */
export async function getLatestProofForJob(jobRef: string): Promise<StoredProof | null> {
  try {
    await ensureTable()
    const { rows } = await pool.query<{ id: string; proof: WorkProof; signature: string; attester: string; cid: string | null }>(
      `SELECT id, proof, signature, attester, cid FROM work_proofs WHERE job_ref = $1 ORDER BY created_at DESC LIMIT 1`,
      [jobRef],
    )
    if (!rows[0]) return null
    return { id: rows[0].id, proof: rows[0].proof, signature: rows[0].signature, attester: rows[0].attester, cid: rows[0].cid ?? null }
  } catch {
    return null
  }
}

export { trustedAttester }
