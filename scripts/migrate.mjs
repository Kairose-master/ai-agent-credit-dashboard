// Idempotent schema migration for the Neon PostgreSQL database.
// Usage: DATABASE_URL=postgres://... node scripts/migrate.mjs  (or `pnpm db:migrate`)
import pg from 'pg'

const sql = /* sql */ `
-- ── Better Auth tables ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user" (
  id            text PRIMARY KEY,
  name          text,
  email         text NOT NULL UNIQUE,
  emailverified boolean NOT NULL DEFAULT false,
  image         text,
  password      text,
  createdat     timestamptz NOT NULL DEFAULT now(),
  updatedat     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session" (
  id        text PRIMARY KEY,
  userid    text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token     text NOT NULL,
  expiresat timestamptz NOT NULL,
  ipaddress text,
  useragent text,
  createdat timestamptz NOT NULL DEFAULT now(),
  updatedat timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "account" (
  id                text PRIMARY KEY,
  userid            text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  accountid         text NOT NULL,
  provider          text NOT NULL,
  provideraccountid text NOT NULL,
  refreshtoken      text,
  accesstoken       text,
  expiresat         timestamptz,
  createdat         timestamptz NOT NULL DEFAULT now(),
  updatedat         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "verification" (
  id         text PRIMARY KEY,
  identifier text NOT NULL,
  value      text NOT NULL,
  expiresat  timestamptz NOT NULL,
  createdat  timestamptz DEFAULT now(),
  updatedat  timestamptz DEFAULT now()
);

-- ── Legacy repair ──────────────────────────────────────────────────
-- Early versions of this database were created with all-lowercase
-- column names (userid, creditscore, ...) that don't match the quoted
-- camelCase identifiers the app uses. Drop such tables when they are
-- empty so they are recreated correctly below; refuse when they hold
-- data, since that needs a manual migration.
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent','creditLine','creditTransaction','creditAssessment','riskMetric','insurancePolicy'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t)
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = t AND column_name = 'userId')
    THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      IF n = 0 THEN
        EXECUTE format('DROP TABLE %I', t);
        RAISE NOTICE 'Dropped legacy lowercase-column table: %', t;
      ELSE
        RAISE EXCEPTION 'Legacy table % has % rows; migrate its data manually before rerunning', t, n;
      END IF;
    END IF;
  END LOOP;
END $$;

-- ── Agent identity ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent" (
  id                   text PRIMARY KEY,
  "userId"             text NOT NULL,
  name                 text NOT NULL,
  description          text,
  "walletAddress"      text NOT NULL UNIQUE,
  "modelVersion"       text DEFAULT 'claude-sonnet-5',
  "creditScore"        numeric(6,2) NOT NULL DEFAULT 0,
  "creditRating"       text DEFAULT 'unrated',
  "riskLevel"          text DEFAULT 'UNKNOWN',
  "riskRating"         text DEFAULT 'unrated',
  "totalCreditLine"    numeric(18,2) DEFAULT 0,
  "availableCredit"    numeric(18,2) DEFAULT 0,
  attestations         jsonb DEFAULT '[]',
  "performanceMetrics" jsonb DEFAULT '{}',
  "createdAt"          timestamptz NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz NOT NULL DEFAULT now()
);

-- Columns added after the initial release (no-ops on fresh databases).
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "modelVersion" text DEFAULT 'claude-sonnet-5';
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "creditRating" text DEFAULT 'unrated';
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "riskLevel" text DEFAULT 'UNKNOWN';
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "smartAccountAddress" text;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'agent' AND column_name = 'creditScore') THEN
    ALTER TABLE "agent" ALTER COLUMN "creditScore" TYPE numeric(6,2);
  END IF;
END $$;

-- ── Behavioral event ledger ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_events (
  id             text PRIMARY KEY,
  agent_id       text NOT NULL,
  task_id        text NOT NULL,
  event_type     text NOT NULL,
  success        boolean NOT NULL DEFAULT true,
  execution_time integer NOT NULL DEFAULT 0,
  token_cost     integer NOT NULL DEFAULT 0,
  quality_score  numeric(4,3),
  detail         jsonb DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_events_agent_id_idx ON agent_events (agent_id, created_at DESC);

-- ── Credit score history (append-only) ─────────────────────────────
CREATE TABLE IF NOT EXISTS credit_scores (
  id                 text PRIMARY KEY,
  agent_id           text NOT NULL,
  score              integer NOT NULL,
  rating             text NOT NULL,
  credit_limit       numeric(18,2) NOT NULL,
  risk_level         text NOT NULL,
  calculation_reason text NOT NULL,
  breakdown          jsonb DEFAULT '{}',
  registry_tx_hash    text,
  attestation_tx_hash text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_scores_agent_id_idx ON credit_scores (agent_id, created_at DESC);
ALTER TABLE credit_scores ADD COLUMN IF NOT EXISTS registry_tx_hash text;
ALTER TABLE credit_scores ADD COLUMN IF NOT EXISTS attestation_tx_hash text;

-- ── Labor market job metadata (on-chain spec is just a hash) ────────
CREATE TABLE IF NOT EXISTS job_specs (
  spec_hash          text PRIMARY KEY,
  title              text NOT NULL,
  description        text,
  requester_agent_id text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ── Async task lifecycle ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_tasks (
  id         text PRIMARY KEY,
  user_id    text NOT NULL,
  agent_id   text NOT NULL,
  task       text NOT NULL,
  status     text NOT NULL DEFAULT 'running',
  output     text,
  result     jsonb,
  credit     jsonb,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_tasks_agent_id_idx ON agent_tasks (agent_id, created_at DESC);

-- ── Existing dashboard tables ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "creditLine" (
  id             text PRIMARY KEY,
  "userId"       text NOT NULL,
  "agentId"      text NOT NULL,
  status         text NOT NULL DEFAULT 'active',
  "totalLimit"   numeric(18,2) NOT NULL,
  used           numeric(18,2) NOT NULL DEFAULT 0,
  available      numeric(18,2) NOT NULL,
  "interestRate" numeric(5,2) NOT NULL DEFAULT 8.5,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "updatedAt"    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "creditTransaction" (
  id            text PRIMARY KEY,
  "userId"      text NOT NULL,
  "fromAgentId" text NOT NULL,
  "toAgentId"   text,
  status        text NOT NULL DEFAULT 'pending',
  amount        numeric(18,2) NOT NULL,
  type          text NOT NULL,
  description   text,
  "approvedAt"  timestamptz,
  "rejectedAt"  timestamptz,
  "settledAt"   timestamptz,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "creditAssessment" (
  id                   text PRIMARY KEY,
  "userId"             text NOT NULL,
  "agentId"            text NOT NULL,
  "onChainActivity"    numeric(5,2) NOT NULL DEFAULT 50,
  "transactionHistory" numeric(5,2) NOT NULL DEFAULT 60,
  "collateralScore"    numeric(5,2) NOT NULL DEFAULT 45,
  "attestationScore"   numeric(5,2) NOT NULL DEFAULT 55,
  "overallScore"       numeric(5,2) NOT NULL DEFAULT 0,
  weights              jsonb DEFAULT '{"onChainActivity":0.25,"transactionHistory":0.35,"collateralScore":0.2,"attestationScore":0.2}',
  "createdAt"          timestamptz NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "riskMetric" (
  id                   text PRIMARY KEY,
  "userId"             text NOT NULL,
  "agentId"            text NOT NULL,
  month                text NOT NULL,
  "defaultProbability" numeric(5,2) NOT NULL DEFAULT 0,
  "ratingBand"         text NOT NULL DEFAULT 'AAA',
  exposure             numeric(18,2) NOT NULL DEFAULT 0,
  "createdAt"          timestamptz NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "insurancePolicy" (
  id           text PRIMARY KEY,
  "userId"     text NOT NULL,
  "agentId"    text NOT NULL,
  "policyType" text NOT NULL,
  coverage     numeric(18,2) NOT NULL,
  premium      numeric(18,2) NOT NULL,
  status       text NOT NULL DEFAULT 'active',
  "expiresAt"  timestamptz NOT NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now()
);
`

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Aborting.')
    process.exit(1)
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  try {
    await pool.query(sql)
    console.log('Migration complete.')
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
