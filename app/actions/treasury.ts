'use server'

import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent, agentEvent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'
import { enforceSpendingPolicy, isValidAddress, spentLast24h, WALLET_DAILY_CAP_USD, WALLET_MAX_TX_USD } from '@/lib/treasury-policy'
import { asActionError } from '@/lib/action-error'

async function requireOwnedAgent(agentId: string) {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  const [found] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!found || found.userId !== session.user.id) throw new Error('Agent not found')
  return found
}

export async function getTreasury(agentId: string) {
  const ag = await requireOwnedAgent(agentId)
  const { isAgentAccountConfigured } = await import('@/lib/onchain/config')

  const info = {
    configured: isAgentAccountConfigured() && Boolean(ag.smartAccountAddress),
    address: ag.smartAccountAddress,
    usdc: null as number | null,
    spent24h: 0,
    maxPerTx: WALLET_MAX_TX_USD,
    dailyCap: WALLET_DAILY_CAP_USD,
  }
  if (info.configured) {
    try {
      const { usdcBalanceOf } = await import('@/lib/onchain/treasury')
      info.usdc = await usdcBalanceOf(ag.smartAccountAddress as `0x${string}`)
      info.spent24h = await spentLast24h(agentId)
    } catch (error) {
      console.error('[treasury] read failed:', error)
    }
  }
  return info
}

/** Owner-initiated withdrawal/payment to any external address. Same policy
 *  and same ledger as agent-initiated transfers. */
export async function sendFromTreasury(agentId: string, to: string, amountUsd: number, memo?: string) {
  const ag = await requireOwnedAgent(agentId)
  if (!ag.smartAccountAddress) throw new Error('Provision the smart account first')
  if (!isValidAddress(to)) throw new Error('Invalid recipient address')

  await enforceSpendingPolicy(agentId, amountUsd)

  try {
    const { usdcBalanceOf, transferUsdc } = await import('@/lib/onchain/treasury')
    const balance = await usdcBalanceOf(ag.smartAccountAddress as `0x${string}`)
    if (amountUsd > balance) throw new Error(`Insufficient balance ($${balance.toFixed(2)})`)

    const txHash = await transferUsdc(agentId, to, amountUsd)

    await db.insert(agentEvent).values({
      id: nanoid(),
      agentId,
      taskId: `wallet-${nanoid(8)}`,
      eventType: 'WALLET_TRANSFER',
      success: true,
      executionTime: 0,
      tokenCost: 0,
      qualityScore: null,
      detail: { amountUsd, to, memo: memo ?? '', txHash, initiator: 'owner' },
    })

    revalidatePath('/profile')
    return { txHash }
  } catch (error) {
    throw asActionError(error, 'sendFromTreasury')
  }
}

const TEST_MINT_MAX_USD = 5000

/** Self-mint test USDC (testnet only — MockUSDC.mint is permissionless).
 *  Not subject to the spending policy: minting isn't spending, it's the
 *  faucet step users need before they can draw credit or post jobs. */
export async function mintTestUsdc(agentId: string, amountUsd: number) {
  const ag = await requireOwnedAgent(agentId)
  if (!ag.smartAccountAddress) throw new Error('Provision the smart account first')
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('Amount must be positive')
  if (amountUsd > TEST_MINT_MAX_USD) throw new Error(`Max ${TEST_MINT_MAX_USD} mUSDC per mint`)

  try {
    const { mintTestUsdc: mint } = await import('@/lib/onchain/treasury')
    const txHash = await mint(agentId, amountUsd, ag.smartAccountAddress as `0x${string}`)

    // Separate event type from WALLET_TRANSFER — minting isn't spending and
    // must NOT count toward the 24h spending cap that gates real transfers.
    await db.insert(agentEvent).values({
      id: nanoid(),
      agentId,
      taskId: `mint-${nanoid(8)}`,
      eventType: 'WALLET_MINT',
      success: true,
      executionTime: 0,
      tokenCost: 0,
      qualityScore: null,
      detail: { amountUsd, to: ag.smartAccountAddress, memo: 'Test USDC mint', txHash, initiator: 'owner' },
    })

    revalidatePath('/profile')
    return { txHash }
  } catch (error) {
    throw asActionError(error, 'mintTestUsdc')
  }
}
