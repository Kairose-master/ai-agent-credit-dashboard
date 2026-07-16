'use server'

import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent, agentEvent, user } from '@/lib/db/schema'
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

async function requireUserId() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
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

/** Shared transfer core: balance check, on-chain transfer, ledger event.
 *  Callers are responsible for ownership + spending-policy checks first. */
async function doTransfer(agentId: string, smartAccountAddress: string, to: string, amountUsd: number, memo: string) {
  const { usdcBalanceOf, transferUsdc } = await import('@/lib/onchain/treasury')
  const balance = await usdcBalanceOf(smartAccountAddress as `0x${string}`)
  if (amountUsd > balance) throw new Error(`Insufficient balance ($${balance.toFixed(2)})`)

  const txHash = await transferUsdc(agentId, to as `0x${string}`, amountUsd)

  await db.insert(agentEvent).values({
    id: nanoid(),
    agentId,
    taskId: `wallet-${nanoid(8)}`,
    eventType: 'WALLET_TRANSFER',
    success: true,
    executionTime: 0,
    tokenCost: 0,
    qualityScore: null,
    detail: { amountUsd, to, memo, txHash, initiator: 'owner' },
  })

  return txHash
}

/** Owner-initiated withdrawal/payment to any external address. Same policy
 *  and same ledger as agent-initiated transfers. */
export async function sendFromTreasury(agentId: string, to: string, amountUsd: number, memo?: string) {
  const ag = await requireOwnedAgent(agentId)
  if (!ag.smartAccountAddress) throw new Error('Provision the smart account first')
  if (!isValidAddress(to)) throw new Error('Invalid recipient address')

  await enforceSpendingPolicy(agentId, amountUsd)

  try {
    const txHash = await doTransfer(agentId, ag.smartAccountAddress, to, amountUsd, memo ?? '')
    revalidatePath('/profile')
    return { txHash }
  } catch (error) {
    throw asActionError(error, 'sendFromTreasury')
  }
}

/** The wallet earnings get swept to on "Withdraw all earnings". Saved once,
 *  reused by every future one-click withdrawal — no re-typing an address
 *  per agent, per payout. */
export async function getPayoutAddress() {
  const userId = await requireUserId()
  const [row] = await db.select({ payoutAddress: user.payoutAddress }).from(user).where(eq(user.id, userId))
  return { payoutAddress: row?.payoutAddress ?? null }
}

export async function setPayoutAddress(address: string) {
  const userId = await requireUserId()
  const trimmed = address.trim()
  if (trimmed && !isValidAddress(trimmed)) throw new Error('Invalid wallet address')
  await db
    .update(user)
    .set({ payoutAddress: trimmed || null, updatedAt: new Date() })
    .where(eq(user.id, userId))
  revalidatePath('/mine')
  return { payoutAddress: trimmed || null }
}

/**
 * One click, every worker settled: sweeps each owned agent's USDC balance
 * to the saved payout address, respecting the same per-tx/24h caps as a
 * manual send (per agent, since the ledger that enforces the cap is keyed
 * per agent). An agent that would exceed its cap sends what it can and
 * reports the shortfall rather than failing the whole batch — the rest
 * still settle.
 */
export async function withdrawAllEarnings() {
  const userId = await requireUserId()
  const [row] = await db.select({ payoutAddress: user.payoutAddress }).from(user).where(eq(user.id, userId))
  const to = row?.payoutAddress
  if (!to) throw new Error('Set a payout wallet first')

  const agents = await db
    .select()
    .from(agent)
    .where(eq(agent.userId, userId))
  const provisioned = agents.filter((a) => a.smartAccountAddress)

  const results: { agentId: string; name: string; sent: number; txHash?: string; error?: string }[] = []

  for (const ag of provisioned) {
    try {
      const { usdcBalanceOf } = await import('@/lib/onchain/treasury')
      const balance = await usdcBalanceOf(ag.smartAccountAddress as `0x${string}`)
      if (balance <= 0) continue

      const spent = await spentLast24h(ag.id)
      // Guard against a misconfigured WALLET_MAX_TX_USD/WALLET_DAILY_CAP_USD
      // (a non-numeric env value produces NaN, which every `<= 0`/`>` cap
      // check below silently treats as false rather than as "invalid") —
      // fail with a clear per-agent error instead of passing NaN downstream.
      if (!Number.isFinite(WALLET_MAX_TX_USD) || !Number.isFinite(WALLET_DAILY_CAP_USD) || !Number.isFinite(spent)) {
        results.push({ agentId: ag.id, name: ag.name, sent: 0, error: 'Spending cap misconfigured — contact the operator' })
        continue
      }
      const remainingCap = Math.max(0, Math.min(WALLET_MAX_TX_USD, WALLET_DAILY_CAP_USD - spent))
      const amount = Math.min(balance, remainingCap)
      if (amount <= 0) {
        results.push({ agentId: ag.id, name: ag.name, sent: 0, error: 'Daily transfer cap reached' })
        continue
      }

      const txHash = await doTransfer(ag.id, ag.smartAccountAddress!, to, amount, 'Withdraw all earnings')
      const capped = amount < balance
      results.push({
        agentId: ag.id,
        name: ag.name,
        sent: amount,
        txHash,
        ...(capped ? { error: `Only $${amount.toFixed(2)} of $${balance.toFixed(2)} sent (cap) — rest available tomorrow` } : {}),
      })
    } catch (error) {
      results.push({
        agentId: ag.id,
        name: ag.name,
        sent: 0,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  revalidatePath('/mine')
  revalidatePath('/profile')
  const totalSent = results.reduce((sum, r) => sum + r.sent, 0)
  return { to, totalSent, results }
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
