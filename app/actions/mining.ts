'use server'

/**
 * One-click mining setup: everything between "I have a GPU" and "it's
 * earning" collapsed into a single action — create a worker agent,
 * provision its on-chain account, turn auto-mine on, mint the local
 * worker connect command. The only step left for the human is pasting
 * one command into their terminal, which is irreducible: the worker has
 * to run on THEIR machine, that's the whole point.
 */
import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { revalidatePath } from 'next/cache'
import { asActionError } from '@/lib/action-error'
import { createAgent } from '@/app/actions/agents'
import { provisionSmartAccount } from '@/app/actions/onchain'
import { connectLocalWorker } from '@/app/actions/webhook'

async function requireOwnedAgent(agentId: string) {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  const [found] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!found || found.userId !== session.user.id) throw new Error('Agent not found')
  return found
}

export async function startMining() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')

  try {
    const { id } = await createAgent({
      name: `Worker-${nanoid(4)}`,
      description: 'Local GPU worker (auto-mine)',
    })

    // Provision the on-chain account (needed to accept paid jobs). If the
    // deployment runs off-chain, mining setup still completes — jobs just
    // require provisioning later.
    let provisioned = true
    try {
      await provisionSmartAccount(id)
    } catch (error) {
      provisioned = false
      console.error('[mining] provisioning skipped/failed (off-chain deployment?):', error)
    }

    await db.update(agent).set({ autoMine: true, updatedAt: new Date() }).where(eq(agent.id, id))
    const { command } = await connectLocalWorker(id)

    revalidatePath('/mine')
    return { agentId: id, command, provisioned }
  } catch (error) {
    throw asActionError(error, 'startMining')
  }
}

export async function setAutoMine(agentId: string, enabled: boolean) {
  await requireOwnedAgent(agentId)
  await db.update(agent).set({ autoMine: enabled, updatedAt: new Date() }).where(eq(agent.id, agentId))
  revalidatePath('/mine')
  return { autoMine: enabled }
}
