'use server'

import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent, creditLine, creditAssessment, riskMetric } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'

async function getUserId() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export async function getAgents() {
  const userId = await getUserId()
  return db
    .select()
    .from(agent)
    .where(eq(agent.userId, userId))
    .orderBy(desc(agent.createdAt))
}

export async function getAgentById(agentId: string) {
  const userId = await getUserId()
  const result = await db
    .select()
    .from(agent)
    .where(eq(agent.id, agentId))
  if (result.length === 0 || result[0].userId !== userId) {
    throw new Error('Agent not found or unauthorized')
  }
  return result[0]
}

export async function createAgent(data: {
  name: string
  walletAddress: string
  description?: string
}) {
  const userId = await getUserId()
  const agentId = nanoid()

  await db.insert(agent).values({
    id: agentId,
    userId,
    name: data.name,
    walletAddress: data.walletAddress,
    description: data.description,
    creditScore: 0,
    riskRating: 'unrated',
  })

  // Create initial credit assessment
  await db.insert(creditAssessment).values({
    id: nanoid(),
    userId,
    agentId,
    onChainActivity: 50,
    transactionHistory: 60,
    collateralScore: 45,
    attestationScore: 55,
  })

  revalidatePath('/agents')
  return { id: agentId }
}

export async function updateAgent(
  agentId: string,
  data: Partial<{ name: string; description: string }>
) {
  const userId = await getUserId()
  const existing = await db
    .select()
    .from(agent)
    .where(eq(agent.id, agentId))
  if (existing.length === 0 || existing[0].userId !== userId) {
    throw new Error('Agent not found or unauthorized')
  }

  await db.update(agent).set(data).where(eq(agent.id, agentId))
  revalidatePath('/agents')
  revalidatePath('/profile')
}

export async function calculateCreditScore(agentId: string) {
  const userId = await getUserId()

  // Get assessment
  const assessments = await db
    .select()
    .from(creditAssessment)
    .where(eq(creditAssessment.agentId, agentId))
  if (assessments.length === 0) throw new Error('Assessment not found')

  const assessment = assessments[0]
  const weights = assessment.weights as Record<string, number>

  const onChain = parseFloat(assessment.onChainActivity) * weights.onChainActivity
  const transaction = parseFloat(assessment.transactionHistory) * weights.transactionHistory
  const collateral = parseFloat(assessment.collateralScore) * weights.collateralScore
  const attestation = parseFloat(assessment.attestationScore) * weights.attestationScore

  const overallScore = onChain + transaction + collateral + attestation

  // Update assessment
  await db
    .update(creditAssessment)
    .set({ overallScore: overallScore.toString() })
    .where(eq(creditAssessment.id, assessment.id))

  // Update agent score and rating
  let riskRating = 'AAA'
  if (overallScore < 40) riskRating = 'D'
  else if (overallScore < 50) riskRating = 'C'
  else if (overallScore < 60) riskRating = 'B'
  else if (overallScore < 75) riskRating = 'A'
  else riskRating = 'AAA'

  await db
    .update(agent)
    .set({ creditScore: overallScore.toString(), riskRating })
    .where(eq(agent.id, agentId))

  revalidatePath('/profile')
  revalidatePath('/credit-scores')
}
