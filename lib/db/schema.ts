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
  requesterAgentId: text('requester_agent_id'),
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
