import { pgTable, text, timestamp, boolean, decimal, integer, jsonb } from 'drizzle-orm/pg-core'

// Better Auth Tables
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailverified').notNull().default(false),
  image: text('image'),
  password: text('password'),
  createdAt: timestamp('createdat', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedat', { withTimezone: true }).notNull().defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('userid').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  expiresAt: timestamp('expiresat', { withTimezone: true }).notNull(),
  ipAddress: text('ipaddress'),
  userAgent: text('useragent'),
  createdAt: timestamp('createdat', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedat', { withTimezone: true }).notNull().defaultNow(),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  userId: text('userid').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('accountid').notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('provideraccountid').notNull(),
  refreshToken: text('refreshtoken'),
  accessToken: text('accesstoken'),
  expiresAt: timestamp('expiresat', { withTimezone: true }),
  createdAt: timestamp('createdat', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedat', { withTimezone: true }).notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresat', { withTimezone: true }).notNull(),
  createdAt: timestamp('createdat', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updatedat', { withTimezone: true }).defaultNow(),
})

/**
 * dm_threads / dm_messages — direct messages between two platform users.
 * One thread per unordered pair (userA, userB); userA is always the
 * lexicographically smaller id so a pair maps to exactly one thread.
 */
export const dmThread = pgTable('dm_threads', {
  id: text('id').primaryKey(),
  userAId: text('user_a_id').notNull(),
  userBId: text('user_b_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const dmMessage = pgTable('dm_messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull(),
  senderId: text('sender_id').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * platform_events — a lightweight, append-only feed of notable cross-user
 * activity (job posted/completed, template published/bought, verified task
 * settled) so the marketplace feels alive. Purely additive/read-only from
 * the app's perspective; existing tables remain the source of truth.
 */
export const platformEvent = pgTable('platform_events', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(), // JOB_POSTED | JOB_COMPLETED | TEMPLATE_PUBLISHED | TEMPLATE_PURCHASED | VERIFIED_TASK_SETTLED
  summary: text('summary').notNull(), // pre-rendered human-readable line, no join needed to display
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * task_progress — live, per-task step feed (PLAN_CREATED, TOOL_EXECUTED,
 * TASK_COMPLETED, ...) pushed by the runtime as a task actually runs, so the
 * UI can show what an agent is doing in real time instead of only a final
 * result. Purely cosmetic, same as platform_events: agent_events (the
 * credit-scoring ledger) remains the sole authoritative record, written
 * once by /api/runtime/callback when the run finishes. A failed live push
 * never breaks the run itself.
 */
export const taskProgress = pgTable('task_progress', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  eventType: text('event_type').notNull(),
  detail: jsonb('detail').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * admin_grants — the access control matrix: rows are (user, permission)
 * pairs, so different admins can hold different capabilities instead of one
 * global "is admin" boolean. ADMIN_EMAIL (env) is a separate superadmin
 * bootstrap — always implicitly holds every permission, so granting/revoking
 * rows here can never lock the platform operator out.
 */
export const adminGrant = pgTable('admin_grants', {
  userId: text('user_id').notNull(),
  permission: text('permission').notNull(), // 'disputes' | 'credit_rules' | ...
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  grantedBy: text('granted_by'), // userId of the admin who granted it, if not the superadmin
})

/**
 * credit_rating_rules — a DMN-style decision table overriding the
 * score -> rating / risk-level thresholds hardcoded in credit-engine's
 * scoring.ts. Empty table = use the shipped defaults (DEFAULT_RATING_RULES /
 * DEFAULT_RISK_RULES). Edited from /admin/credit-rules (requires the
 * 'credit_rules' permission) so a non-engineer can change lending policy
 * without touching code.
 */
export const creditRatingRule = pgTable('credit_rating_rules', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(), // 'rating' | 'risk_level'
  minScore: integer('min_score').notNull(),
  value: text('value').notNull(), // e.g. 'AAA' (kind=rating) or 'LOW' (kind=risk_level)
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'), // userId of the admin who last wrote this table
})

/**
 * user_api_keys — BYOK (bring your own key).
 * Each user's Anthropic key, AES-256-GCM encrypted at rest; their agent runs
 * bill their own account. Never returned to the client, never logged.
 */
export const userApiKey = pgTable('user_api_keys', {
  userId: text('user_id').primaryKey(),
  anthropicKeyEnc: text('anthropic_key_enc').notNull(),
  keyHint: text('key_hint').notNull(), // last 4 chars, for display only
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// App Tables
export const agent = pgTable('agent', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  walletAddress: text('walletAddress').notNull().unique(),
  smartAccountAddress: text('smartAccountAddress'), // ERC-4337 Kernel account (Sepolia)
  customInstructions: text('customInstructions'), // from a purchased/cloned agent template, if any
  runtimeType: text('runtimeType').default('platform'), // 'platform' | 'webhook' (BYO endpoint we call) | 'local' (owner's worker polls us — no tunnel needed)
  webhookUrl: text('webhookUrl'), // BYO agent HTTP endpoint, called instead of the platform runtime
  webhookSecretEnc: text('webhookSecretEnc'), // AES-256-GCM encrypted per-agent secret (webhook callbacks AND local-worker polling)
  lastPollAt: timestamp('lastPollAt', { withTimezone: true }), // local worker's last poll — powers the online/offline badge
  erc8004Id: integer('erc8004Id'), // this agent's id in the ERC-8004 Identity Registry, once registered
  autoMine: boolean('autoMine').notNull().default(false), // auto-accept qualifying open jobs when this local worker polls idle
  modelVersion: text('modelVersion').default('claude-sonnet-5'),
  creditScore: decimal('creditScore', { precision: 6, scale: 2 }).notNull().default('0'),
  creditRating: text('creditRating').default('unrated'),
  riskLevel: text('riskLevel').default('UNKNOWN'),
  riskRating: text('riskRating').default('unrated'),
  totalCreditLine: decimal('totalCreditLine', { precision: 18, scale: 2 }).default('0'),
  availableCredit: decimal('availableCredit', { precision: 18, scale: 2 }).default('0'),
  attestations: jsonb('attestations').default([]),
  performanceMetrics: jsonb('performanceMetrics').default({}),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * agent_events — the behavioral ledger.
 * Every action taken by an agent runtime produces one structured event.
 * These rows are the raw input of the credit scoring engine: credit is
 * derived exclusively from recorded behavior, never assigned manually.
 */
export const agentEvent = pgTable('agent_events', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  taskId: text('task_id').notNull(),
  eventType: text('event_type').notNull(), // TASK_STARTED | PLAN_CREATED | TOOL_EXECUTED | TASK_COMPLETED | TASK_FAILED | ACHIEVEMENT_VERIFIED
  success: boolean('success').notNull().default(true),
  executionTime: integer('execution_time').notNull().default(0), // seconds
  tokenCost: integer('token_cost').notNull().default(0),
  qualityScore: decimal('quality_score', { precision: 4, scale: 3 }), // 0.000 – 1.000, set by the evaluation node
  detail: jsonb('detail').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * agent_tasks — async task lifecycle.
 * POST /tasks creates a row (status running) and returns immediately, so
 * the request never blocks on the multi-minute agent run and can't hit the
 * serverless function timeout. The runtime calls back on completion; the
 * dashboard polls this row for the result.
 */
export const agentTask = pgTable('agent_tasks', {
  id: text('id').primaryKey(), // taskId
  userId: text('user_id').notNull(),
  agentId: text('agent_id').notNull(),
  task: text('task').notNull(),
  status: text('status').notNull().default('running'), // running | processing | completed | failed
  output: text('output'),
  result: jsonb('result'), // { plan, qualityScore, evaluation, executionTime, tokenCost }
  credit: jsonb('credit'), // credit state after recalculation
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * agent_templates — published agent "recipes" (custom instructions) other
 * users can buy to spawn their own new agent from. Credit history never
 * transfers: the spawned agent starts at a genuine cold start and earns its
 * own score. The exemplarAgentId points at the creator's real agent, whose
 * actual behavioral history (lib/db/schema agentEvent/verifiableTask/etc.)
 * serves as the portfolio proof shown to buyers — no fabricated claims.
 */
export const agentTemplate = pgTable('agent_templates', {
  id: text('id').primaryKey(),
  creatorUserId: text('creator_user_id').notNull(),
  exemplarAgentId: text('exemplar_agent_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  customInstructions: text('custom_instructions').notNull(),
  priceUsd: decimal('price_usd', { precision: 18, scale: 2 }).notNull().default('0'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** One purchase = one newly spawned agent for the buyer. */
export const agentTemplatePurchase = pgTable('agent_template_purchases', {
  id: text('id').primaryKey(),
  templateId: text('template_id').notNull(),
  buyerUserId: text('buyer_user_id').notNull(),
  buyerAgentId: text('buyer_agent_id').notNull(),
  priceUsd: decimal('price_usd', { precision: 18, scale: 2 }).notNull(),
  txHash: text('tx_hash'), // null for free templates
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * job_specs — off-chain metadata for on-chain jobs.
 * The LaborMarket contract stores only a specHash; the human-readable title
 * and description live here, keyed by that hash. On-chain = money/state,
 * off-chain = content.
 */
export const jobSpec = pgTable('job_specs', {
  specHash: text('spec_hash').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  acceptanceCriteria: text('acceptance_criteria'), // what "done" means; fed to the worker agent's task prompt AND to dispute review
  requesterAgentId: text('requester_agent_id'),
  workerAgentId: text('worker_agent_id'), // set once a worker accepts
  onchainJobId: integer('onchain_job_id'), // the LaborMarket jobId, once known
  agentTaskId: text('agent_task_id'), // links to agent_tasks — the real run that produced the deliverable
  disputeNote: text('dispute_note'), // requester's reason, if disputed
  attachmentUrl: text('attachment_url'), // source material the worker agent should act on (Vercel Blob)
  attachmentName: text('attachment_name'),
  // Auto-graded code jobs: requester-authored Python asserts run against the
  // worker's submitted code by the PLATFORM runtime (grader ≠ solver).
  testCode: text('test_code'),
  testResult: jsonb('test_result').$type<{ passed: boolean | null; output: string; gradedAt: string }>(),
  // Failed-tests auto-return: how many times this spec lineage has been
  // auto-reposted, and which workers already failed it (blocked from
  // re-accepting the repost).
  repostCount: integer('repost_count').notNull().default(0),
  failedWorkerIds: jsonb('failed_worker_ids').$type<string[]>(),
  // Mining-pool-style claim lock: before any on-chain accept, a worker
  // atomically claims the spec here — losers skip in milliseconds instead
  // of racing to an on-chain revert. TTL'd (stale claims expire) so a
  // claimer that dies releases the job.
  claimedByAgentId: text('claimed_by_agent_id'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * verifiable_tasks — verified-task lifecycle (the trustworthy quality signal).
 * The server generates problem + answer (grader ≠ solver), escrows the bounty
 * on-chain, sends only the problem to the solving agent, and on callback
 * grades the output against the hidden answer; correct answers settle the
 * escrow via commit-reveal. The answer/salt stay server-side until reveal.
 */
export const verifiableTask = pgTable('verifiable_tasks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  solverAgentId: text('solver_agent_id').notNull(),
  requesterAgentId: text('requester_agent_id').notNull(),
  difficulty: integer('difficulty').notNull(),
  problem: text('problem').notNull(),
  answer: text('answer').notNull(), // hidden ground truth
  salt: text('salt').notNull(), // commit-reveal salt
  bountyUsd: decimal('bounty_usd', { precision: 18, scale: 2 }).notNull(),
  onchainId: integer('onchain_id'),
  agentTaskId: text('agent_task_id'), // links to agent_tasks (the solve run)
  status: text('status').notNull().default('posting'), // posting | solving | settling | completed | failed | error
  submittedAnswer: text('submitted_answer'),
  postTxHash: text('post_tx_hash'),
  settleTxHash: text('settle_tx_hash'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * credit_scores — append-only score history.
 * One row per recalculation, so the dashboard can show credit evolution
 * (before → after) together with the reason for each change.
 */
export const creditScoreEntry = pgTable('credit_scores', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  score: integer('score').notNull(), // 300 – 990
  rating: text('rating').notNull(), // AAA … D
  creditLimit: decimal('credit_limit', { precision: 18, scale: 2 }).notNull(),
  riskLevel: text('risk_level').notNull(), // LOW | MODERATE | ELEVATED | HIGH
  calculationReason: text('calculation_reason').notNull(),
  breakdown: jsonb('breakdown').default({}), // per-factor component scores
  registryTxHash: text('registry_tx_hash'), // on-chain limit publish (optional)
  attestationTxHash: text('attestation_tx_hash'), // EAS attestation (optional)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const creditLine = pgTable('creditLine', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  agentId: text('agentId').notNull(),
  status: text('status').notNull().default('active'),
  totalLimit: decimal('totalLimit', { precision: 18, scale: 2 }).notNull(),
  used: decimal('used', { precision: 18, scale: 2 }).notNull().default('0'),
  available: decimal('available', { precision: 18, scale: 2 }).notNull(),
  interestRate: decimal('interestRate', { precision: 5, scale: 2 }).notNull().default('8.5'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

export const creditTransaction = pgTable('creditTransaction', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  fromAgentId: text('fromAgentId').notNull(),
  toAgentId: text('toAgentId'),
  status: text('status').notNull().default('pending'),
  amount: decimal('amount', { precision: 18, scale: 2 }).notNull(),
  type: text('type').notNull(),
  description: text('description'),
  approvedAt: timestamp('approvedAt', { withTimezone: true }),
  rejectedAt: timestamp('rejectedAt', { withTimezone: true }),
  settledAt: timestamp('settledAt', { withTimezone: true }),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

export const creditAssessment = pgTable('creditAssessment', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  agentId: text('agentId').notNull(),
  onChainActivity: decimal('onChainActivity', { precision: 5, scale: 2 }).notNull().default('50'),
  transactionHistory: decimal('transactionHistory', { precision: 5, scale: 2 }).notNull().default('60'),
  collateralScore: decimal('collateralScore', { precision: 5, scale: 2 }).notNull().default('45'),
  attestationScore: decimal('attestationScore', { precision: 5, scale: 2 }).notNull().default('55'),
  overallScore: decimal('overallScore', { precision: 5, scale: 2 }).notNull().default('0'),
  weights: jsonb('weights').default({
    onChainActivity: 0.25,
    transactionHistory: 0.35,
    collateralScore: 0.2,
    attestationScore: 0.2,
  }),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

export const riskMetric = pgTable('riskMetric', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  agentId: text('agentId').notNull(),
  month: text('month').notNull(),
  defaultProbability: decimal('defaultProbability', { precision: 5, scale: 2 }).notNull().default('0'),
  ratingBand: text('ratingBand').notNull().default('AAA'),
  exposure: decimal('exposure', { precision: 18, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

export const insurancePolicy = pgTable('insurancePolicy', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  agentId: text('agentId').notNull(),
  policyType: text('policyType').notNull(),
  coverage: decimal('coverage', { precision: 18, scale: 2 }).notNull(),
  premium: decimal('premium', { precision: 18, scale: 2 }).notNull(),
  status: text('status').notNull().default('active'),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})
