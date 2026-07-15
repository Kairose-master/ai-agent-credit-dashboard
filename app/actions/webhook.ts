'use server'

import { headers } from 'next/headers'
import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { generateWebhookSecret, encryptWebhookSecret } from '@/lib/webhook'

async function requireOwnedAgent(agentId: string) {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  const [found] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!found || found.userId !== session.user.id) throw new Error('Agent not found')
  return found
}

export async function getWebhookConfig(agentId: string) {
  const ag = await requireOwnedAgent(agentId)
  return {
    runtimeType: ag.runtimeType ?? 'platform',
    webhookUrl: ag.webhookUrl,
    hasSecret: Boolean(ag.webhookSecretEnc),
    lastPollAt: ag.lastPollAt ? ag.lastPollAt.toISOString() : null,
  }
}

/** Switch this agent to run on the owner's own HTTP endpoint instead of the
 *  platform's Python runtime. No third-party code executes on our servers —
 *  we only POST the task and wait for a callback in our existing format. */
export async function setWebhookUrl(agentId: string, url: string) {
  await requireOwnedAgent(agentId)
  const trimmed = url.trim()
  if (trimmed && !/^https:\/\//.test(trimmed)) {
    throw new Error('Webhook URL must start with https://')
  }
  await db
    .update(agent)
    .set({
      webhookUrl: trimmed || null,
      runtimeType: trimmed ? 'webhook' : 'platform',
      updatedAt: new Date(),
    })
    .where(eq(agent.id, agentId))
  revalidatePath('/profile')
}

export async function switchToPlatformRuntime(agentId: string) {
  await requireOwnedAgent(agentId)
  await db.update(agent).set({ runtimeType: 'platform', updatedAt: new Date() }).where(eq(agent.id, agentId))
  revalidatePath('/profile')
}

/**
 * One-touch "sell your locally-hosted AI's labor": switches the agent to
 * pull mode ('local'), mints its per-agent secret, and returns a single
 * copy-paste command that runs the worker on the owner's machine. The
 * worker connects OUTBOUND (polling) — no tunnel, no public URL, no port
 * forwarding. The token bundles {agentId, secret, platform origin} so the
 * command is fully self-contained; like the webhook secret, it is shown
 * once and only the encrypted secret is stored.
 */
export async function connectLocalWorker(agentId: string) {
  await requireOwnedAgent(agentId)

  const secret = generateWebhookSecret()
  await db
    .update(agent)
    .set({
      runtimeType: 'local',
      webhookSecretEnc: encryptWebhookSecret(secret),
      updatedAt: new Date(),
    })
    .where(eq(agent.id, agentId))

  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const origin = `${proto}://${host}`

  const token = Buffer.from(JSON.stringify({ a: agentId, s: secret, u: origin })).toString('base64url')
  const command = `curl -fsSL ${origin}/ledgermind-worker.mjs -o ledgermind-worker.mjs && node ledgermind-worker.mjs --token ${token}`

  revalidatePath('/profile')
  return { command }
}

/** Generates (or rotates) this agent's callback secret. Returned ONCE in
 *  plaintext — only the encrypted form is stored. Configure it on your
 *  webhook server as the X-Runtime-Secret header it sends back to us. */
export async function generateAgentWebhookSecret(agentId: string) {
  await requireOwnedAgent(agentId)
  const secret = generateWebhookSecret()
  await db
    .update(agent)
    .set({ webhookSecretEnc: encryptWebhookSecret(secret), updatedAt: new Date() })
    .where(eq(agent.id, agentId))
  revalidatePath('/profile')
  return { secret }
}
