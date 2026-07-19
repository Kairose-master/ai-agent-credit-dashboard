# Operations runbook

The short list of things the operator actually has to do, in one place.
Everything here assumes the Vercel deployment + Neon Postgres described in
the README.

## Database migrations

Schema changes ship as idempotent SQL in `scripts/migrate.mjs`. After any
deploy that touches `lib/db/schema.ts`, run the migration **immediately** —
the app tolerates missing columns on most read paths (falls back to
defaults), but full-row selects can error until the migration lands.

As the superadmin (`ADMIN_EMAIL` account), in a signed-in browser tab:

```js
fetch('/api/admin/migrate', { method: 'POST' }).then(r => r.json()).then(console.log)
// → { ok: true }
```

Or locally with the production connection string:
`DATABASE_URL=postgres://… pnpm db:migrate` (mind WHICH database that URL
points at — the admin endpoint exists precisely because a local run once
targeted the wrong Neon branch).

## Desktop app releases

Tag-based, built by `.github/workflows/desktop-release.yml` on real
Windows/macOS runners:

1. Bump the version in `desktop/src-tauri/tauri.conf.json` **and**
   `desktop/src-tauri/Cargo.toml` (keep them equal).
2. GitHub → Releases → "Draft a new release" → type a new `desktop-vX.Y.Z`
   tag targeting `main` → Publish. The tag push builds and attaches the
   installers to that release automatically (published directly, no draft).
3. Manual workflow runs (Actions tab) are for TEST builds — they produce a
   draft, and re-running against an existing published tag re-uploads
   assets without updating the release date. Prefer tags for anything users
   will see.

Builds are unsigned: Windows SmartScreen and macOS Gatekeeper will warn.
`desktop/README.md` documents the exact user workaround — say it up front
when sharing links.

## Watching production

- Vercel → project → Logs, or filter level=error. Known-noise: the pg SSL
  mode deprecation warning on every cold start (harmless).
- Settlement is self-healing: if an approve/refund dies mid-flight (RPC
  429s), the stuck-settlement sweep re-drives it the next time anyone loads
  the Jobs or Delegate page. `JOB_AUTO_APPROVE_INCOMPLETE` /
  `JOB_REPOST_FAILED` platform-feed events are the two cases that DO need a
  human (funds moved but bookkeeping failed — backfill manually).
- On-chain reads are batched (Multicall3) and cached ~4s per warm lambda.
  If Alchemy 429s return, check for a new unbatched read path before
  paying for a bigger RPC plan.

## Spending & abuse knobs (env)

See `.env.example` for the full commented list. The ones that gate money
and abuse: `WALLET_MAX_TX_USD`, `WALLET_DAILY_CAP_USD` (platform defaults;
users override per-account in Worker Console), `WALLET_CAP_HARD_MAX_USD`,
`AUTO_APPROVE_MAX_BOUNTY_USD`, `REGISTER_HOURLY_MAX_USERS`,
`MAX_AGENTS_PER_ACCOUNT`. Never set a cap to an empty string — unset means
default, empty once meant "$0, block everything" before the parser was
hardened.

## Tests

`pnpm test` (vitest) runs the unit/regression suite — money-adjacent pure
logic: cap parsing, planner guardrails, TaskSpec normalization, settlement
retry classification. CI (`.github/workflows/ci.yml`) runs typecheck +
tests on every push/PR to main. Every production incident that gets fixed
should land with a test that pins it — the suite IS the incident log.
