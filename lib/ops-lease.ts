/**
 * Cross-instance lease for background work.
 *
 * Every sweep in this codebase throttles with a module-level timestamp,
 * which is per-lambda-instance — fine when one scheduler calls one
 * endpoint, useless the moment background work is driven by traffic,
 * because each concurrent instance has its own clock and they all think
 * they are due. The sweeps are individually idempotent, so the failure is
 * wasted on-chain calls and duplicate reverts rather than lost money, but
 * it is still the wrong shape.
 *
 * This is one atomic statement in Postgres: insert the lease, or steal it
 * only if the existing one has expired. Exactly one caller gets a row back.
 * Self-migrating like platform_secrets, so no migration gates the fix.
 */
import { pool } from '@/lib/db'

let tableReady: Promise<void> | null = null

function ensureTable(): Promise<void> {
  tableReady ??= pool
    .query(
      `CREATE TABLE IF NOT EXISTS ops_leases (
         name text PRIMARY KEY,
         leased_until timestamptz NOT NULL
       )`,
    )
    .then(() => undefined)
  return tableReady
}

/**
 * Try to take `name` for `ttlMs`. Returns true to exactly one caller until
 * the lease expires. Any failure returns false — a lease system that
 * fails OPEN would let every instance run at once, which is the situation
 * it exists to prevent.
 */
export async function acquireOpsLease(name: string, ttlMs: number): Promise<boolean> {
  try {
    await ensureTable()
    const { rows } = await pool.query(
      `INSERT INTO ops_leases (name, leased_until)
       VALUES ($1, now() + make_interval(secs => $2))
       ON CONFLICT (name) DO UPDATE
         SET leased_until = EXCLUDED.leased_until
         WHERE ops_leases.leased_until < now()
       RETURNING name`,
      [name, Math.max(1, Math.round(ttlMs / 1000))],
    )
    return rows.length > 0
  } catch (error) {
    console.error('[ops-lease] acquiring', name, 'failed:', error)
    return false
  }
}
