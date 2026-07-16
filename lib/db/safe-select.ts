import { user } from '@/lib/db/schema'

/**
 * A fixed, safe column set for `user` — never every schema-declared column.
 *
 * `db.select().from(user)` (no column list) and `db.query.user.findFirst()`
 * both expand to SELECT every column schema.ts declares, regardless of
 * whether the database migration adding a new one has actually run. That
 * mismatch already took production login down once (a new `payoutAddress`
 * column shipped ahead of its migration broke every session check) — see
 * lib/get-session.ts. This constant is the fix applied at the query layer
 * instead of by hand at each call site: extend it only when a real caller
 * needs the extra column, not defensively, and every `db.select(...)`
 * against `user` should pass it (or an explicit narrower subset) rather
 * than an empty column list.
 */
export const SAFE_USER_COLUMNS = {
  id: user.id,
  name: user.name,
  email: user.email,
  password: user.password,
} as const
