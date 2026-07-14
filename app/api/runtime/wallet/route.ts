import { db } from '@/lib/db'
import { agent, agentEvent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { enforceSpendingPolicy, isValidAddress, spentLast24h, WALLET_DAILY_CAP_USD, WALLET_MAX_TX_USD } from '@/lib/treasury-policy'

export const maxDuration = 120

/**
 * POST /api/runtime/wallet — the agent's hands on its own wallet.
 * Called by the Python runtime (shared-secret authed) when the agent invokes
 * its send_usdc / wallet_balance tools mid-task. Every transfer passes the
 * spending policy and is recorded as a WALLET_TRANSFER behavioral event.
 */
export async function POST(request: Request) {
  const expected = process.env.RUNTIME_SHARED_SECRET ?? ''
  if (expected && request.headers.get('x-runtime-secret') !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const action = body?.action as string | undefined
  const agentId = body?.agent_id as string | undefined
  if (!action || !agentId) return Response.json({ error: 'Missing action or agent_id' }, { status: 400 })

  const [ag] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!ag?.smartAccountAddress) {
    return Response.json({ error: 'Agent has no smart account' }, { status: 404 })
  }

  try {
    const { isAgentAccountConfigured } = await import('@/lib/onchain/config')
    if (!isAgentAccountConfigured()) {
      return Response.json({ error: 'On-chain wallet not configured' }, { status: 503 })
    }
    const { usdcBalanceOf, transferUsdc } = await import('@/lib/onchain/treasury')

    if (action === 'balance') {
      const balance = await usdcBalanceOf(ag.smartAccountAddress as `0x${string}`)
      const spent = await spentLast24h(agentId)
      return Response.json({
        address: ag.smartAccountAddress,
        usdc: balance,
        policy: { maxPerTx: WALLET_MAX_TX_USD, dailyCap: WALLET_DAILY_CAP_USD, spent24h: spent },
      })
    }

    if (action === 'transfer') {
      const to = String(body?.to ?? '')
      const amountUsd = Number(body?.amount)
      const memo = String(body?.memo ?? '').slice(0, 200)
      if (!isValidAddress(to)) return Response.json({ error: 'Invalid recipient address' }, { status: 400 })

      await enforceSpendingPolicy(agentId, amountUsd)
      const balance = await usdcBalanceOf(ag.smartAccountAddress as `0x${string}`)
      if (amountUsd > balance) {
        return Response.json({ error: `Insufficient balance ($${balance.toFixed(2)})` }, { status: 400 })
      }

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
        detail: { amountUsd, to, memo, txHash, initiator: 'agent' },
      })

      return Response.json({ txHash, amountUsd, to })
    }

    return Response.json({ error: `Unknown action ${action}` }, { status: 400 })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    )
  }
}
