import { pgTable, text, timestamp, boolean, decimal, jsonb } from 'drizzle-orm/pg-core'

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

// App Tables
export const agent = pgTable('agent', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  walletAddress: text('walletAddress').notNull().unique(),
  creditScore: decimal('creditScore', { precision: 5, scale: 2 }).notNull().default('0'),
  riskRating: text('riskRating').default('unrated'),
  totalCreditLine: decimal('totalCreditLine', { precision: 18, scale: 2 }).default('0'),
  availableCredit: decimal('availableCredit', { precision: 18, scale: 2 }).default('0'),
  attestations: jsonb('attestations').default([]),
  performanceMetrics: jsonb('performanceMetrics').default({}),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
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
