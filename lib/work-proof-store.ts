import { pool } from '@/lib/db'
import { contentHashOf, signWorkProof, trustedAttester, WORK_PROOF_SCHEMA, type WorkProof } from '@/lib/attestation'

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
       created_at timestamptz NOT NULL DEFAULT now()
     )`,
  )
  await pool.query(`CREATE INDEX IF NOT EXISTS work_proofs_job_ref_idx ON work_proofs (job_ref)`)
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

    const id = crypto.randomUUID()
    await ensureTable()
    await pool.query(
      `INSERT INTO work_proofs (id, job_ref, content_hash, attester, signature, proof)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, proof.jobRef, proof.contentHash, signed.attester, signed.signature, JSON.stringify(proof)],
    )
    return { id, proof, signature: signed.signature, attester: signed.attester }
  } catch {
    return null
  }
}

export async function getWorkProof(id: string): Promise<StoredProof | null> {
  try {
    await ensureTable()
    const { rows } = await pool.query<{ id: string; proof: WorkProof; signature: string; attester: string }>(
      `SELECT id, proof, signature, attester FROM work_proofs WHERE id = $1`,
      [id],
    )
    if (!rows[0]) return null
    return { id: rows[0].id, proof: rows[0].proof, signature: rows[0].signature, attester: rows[0].attester }
  } catch {
    return null
  }
}

/** Latest proof for a job reference (jobs can be re-graded / re-posted). */
export async function getLatestProofForJob(jobRef: string): Promise<StoredProof | null> {
  try {
    await ensureTable()
    const { rows } = await pool.query<{ id: string; proof: WorkProof; signature: string; attester: string }>(
      `SELECT id, proof, signature, attester FROM work_proofs WHERE job_ref = $1 ORDER BY created_at DESC LIMIT 1`,
      [jobRef],
    )
    if (!rows[0]) return null
    return { id: rows[0].id, proof: rows[0].proof, signature: rows[0].signature, attester: rows[0].attester }
  } catch {
    return null
  }
}

export { trustedAttester }
