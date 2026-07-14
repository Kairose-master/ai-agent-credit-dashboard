/**
 * Spending policy for autonomous wallet control.
 *
 * The agent (Claude, mid-reasoning) may move real funds, so every transfer —
 * agent-initiated or manual — passes these checks, and every executed
 * transfer lands in the behavioral ledger as a WALLET_TRANSFER event. The
 * daily cap is computed from that ledger, so the ledger is also the enforcer.
 */
import { db } from '@/lib/db'
import { agentEvent } from '@/lib/db/schema'
import { and, eq, gte } from 'drizzle-orm'

export const WALLET_MAX_TX_USD = Number(process.env.WALLET_MAX_TX_USD ?? 100)
export const WALLET_DAILY_CAP_USD = Number(process.env.WALLET_DAILY_CAP_USD ?? 500)

export function isValidAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value)
}

/** Sum of transfers in the last 24h, read from the event ledger. */
export async function spentLast24h(agentId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const rows = await db
    .select()
    .from(agentEvent)
    .where(
      and(
        eq(agentEvent.agentId, agentId),
        eq(agentEvent.eventType, 'WALLET_TRANSFER'),
        gte(agentEvent.createdAt, since),
      ),
    )
  return rows.reduce((sum, e) => sum + (Number((e.detail as any)?.amountUsd) || 0), 0)
}

/** Throws with a human-readable reason when the transfer violates policy. */
export async function enforceSpendingPolicy(agentId: string, amountUsd: number): Promise<void> {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('Amount must be positive')
  if (amountUsd > WALLET_MAX_TX_USD) {
    throw new Error(`Per-transfer cap is $${WALLET_MAX_TX_USD} (requested $${amountUsd})`)
  }
  const spent = await spentLast24h(agentId)
  if (spent + amountUsd > WALLET_DAILY_CAP_USD) {
    throw new Error(
      `Daily cap $${WALLET_DAILY_CAP_USD} would be exceeded (spent $${spent.toFixed(2)} in 24h)`,
    )
  }
}
