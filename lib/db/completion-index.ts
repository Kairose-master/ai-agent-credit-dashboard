/**
 * A database-enforced "one completion event per job".
 *
 * `creditWorkerForJob` guards itself by SELECTing for an existing
 * JOB_COMPLETED event and returning early if it finds one. That closes the
 * *sequential* case — a retry, a second call minutes later — and it is the
 * guard that makes `reconcileUncreditedPayouts` safe to run at all.
 *
 * It does not close the *concurrent* case. Check-then-insert is two
 * statements, and at Postgres' default READ COMMITTED two callers can both
 * find nothing and both insert. Five call sites can observe the same
 * completed job (settlement sweep, delegation tick, two approve paths,
 * reconciliation), several of them driven by traffic across independent
 * lambdas, so "at the same moment" is not hypothetical. The result is a
 * worker whose public earnings and job count are inflated for work done
 * once — the one number this platform exists to keep honest.
 *
 * A partial unique index is the only thing that actually decides the race:
 * whichever transaction commits second is rejected by Postgres, and the
 * insert's ON CONFLICT DO NOTHING turns that rejection into a no-op.
 *
 * Self-migrating like the other tables here (see lib/db/ensure-columns.ts).
 * If the index cannot be created — most likely because duplicate completion
 * events already exist from before the guard shipped — that is logged loudly
 * and the app-level guard remains in force. Silence would be worse: it would
 * read as "protected".
 */
import { pool } from '@/lib/db'

let indexReady: Promise<boolean> | null = null

const CREATE_INDEX = `
  CREATE UNIQUE INDEX IF NOT EXISTS agent_events_job_completed_once
    ON agent_events (task_id)
    WHERE event_type = 'JOB_COMPLETED'
`

/**
 * Returns true when the unique index is in place. Memoized per instance —
 * the statement only has to succeed once, ever, for every process.
 */
export function ensureCompletionUniqueIndex(): Promise<boolean> {
  indexReady ??= pool
    .query(CREATE_INDEX)
    .then(() => true)
    .catch((error) => {
      console.error(
        '[completion-index] could not create agent_events_job_completed_once — ' +
          'duplicate JOB_COMPLETED events probably already exist for some task_id. ' +
          'Double-credit is still guarded in application code only. ' +
          'Fix: delete the duplicates, then redeploy. Error:',
        error,
      )
      // Don't memoize a failure forever — a later pass (after cleanup) should
      // be able to succeed.
      indexReady = null
      return false
    })
  return indexReady
}
