'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  agent,
  creditLine,
  creditAssessment,
  riskMetric,
  creditTransaction,
  insurancePolicy,
} from '@/lib/db/schema'
import { headers } from 'next/headers'
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'

export async function seedDemoData() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')

  const userId = session.user.id

  // Check if already seeded
  const existing = await db.select().from(agent).where(eq(agent.userId, userId))
  if (existing.length > 0) {
    return { message: 'Demo data already exists' }
  }

  // Create demo agents
  const agents = [
    {
      id: nanoid(),
      name: 'Atlas Prime',
      walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
      description: 'High-frequency trading bot optimized for DeFi arbitrage',
    },
    {
      id: nanoid(),
      name: 'Sentinel Protocol',
      walletAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      description: 'Risk management and portfolio balancing automation',
    },
    {
      id: nanoid(),
      name: 'Nexus Flow',
      walletAddress: '0xfedcba9876543210fedcba9876543210fedcba98',
      description: 'Liquidity provision and market-making agent',
    },
  ]

  for (const ag of agents) {
    // Create agent
    await db.insert(agent).values({
      id: ag.id,
      userId,
      name: ag.name,
      walletAddress: ag.walletAddress,
      description: ag.description,
      creditScore: 75,
      riskRating: 'A',
      totalCreditLine: 500000,
      availableCredit: 350000,
    })

    // Create credit line
    await db.insert(creditLine).values({
      id: nanoid(),
      userId,
      agentId: ag.id,
      status: 'active',
      totalLimit: 500000,
      used: 150000,
      available: 350000,
      interestRate: 8.5,
    })

    // Create credit assessment
    await db.insert(creditAssessment).values({
      id: nanoid(),
      userId,
      agentId: ag.id,
      onChainActivity: 85,
      transactionHistory: 78,
      collateralScore: 72,
      attestationScore: 68,
      overallScore: 75,
    })

    // Create risk metrics for 6 months
    const months = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']
    for (const month of months) {
      await db.insert(riskMetric).values({
        id: nanoid(),
        userId,
        agentId: ag.id,
        month,
        defaultProbability: Math.random() * 5,
        ratingBand: 'A',
        exposure: 100000 + Math.random() * 100000,
      })
    }

    // Create insurance policy
    await db.insert(insurancePolicy).values({
      id: nanoid(),
      userId,
      agentId: ag.id,
      policyType: 'Default Coverage',
      coverage: 250000,
      premium: 2500,
      status: 'active',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    })
  }

  // Create demo transactions
  await db.insert(creditTransaction).values({
    id: nanoid(),
    userId,
    fromAgentId: agents[0].id,
    toAgentId: agents[1].id,
    status: 'approved',
    amount: 50000,
    type: 'credit_request',
    description: 'Liquidity top-up for market correction',
    approvedAt: new Date(),
  })

  await db.insert(creditTransaction).values({
    id: nanoid(),
    userId,
    fromAgentId: agents[1].id,
    toAgentId: agents[2].id,
    status: 'pending',
    amount: 75000,
    type: 'credit_request',
    description: 'Emergency capital deployment',
  })

  return { message: 'Demo data seeded successfully' }
}
