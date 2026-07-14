/**
 * BYO Agent Webhook support.
 *
 * Instead of running on our Python runtime, an agent can be configured to
 * run on the OWNER'S OWN infrastructure: we POST the task to their webhook
 * URL, and their server calls back POST /api/runtime/callback with the same
 * payload shape our Python runtime uses. No third-party code ever executes
 * on our servers — this is why it's the safe way to "bring your own agent".
 *
 * Auth is per-agent (not the platform's single RUNTIME_SHARED_SECRET), so
 * one agent's webhook can never forge a callback for another agent's task.
 */
import { db } from '@/lib/db'
import { agent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { encryptSecret, decryptSecret } from '@/lib/crypto'
import { randomBytes } from 'node:crypto'

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}

export { encryptSecret as encryptWebhookSecret }

export type CallbackAuth =
  | { required: false } // platform runtime, no RUNTIME_SHARED_SECRET configured (open dev mode)
  | { required: true; secret: string } // must match exactly

/** What an incoming callback for this agent's task must present to be authentic. */
export async function resolveCallbackAuth(agentId: string): Promise<CallbackAuth> {
  const [ag] = await db.select().from(agent).where(eq(agent.id, agentId))

  if (ag?.runtimeType === 'webhook' && ag.webhookSecretEnc) {
    try {
      return { required: true, secret: decryptSecret(ag.webhookSecretEnc) }
    } catch (error) {
      console.error('[webhook] failed to decrypt secret for agent', agentId, error)
      // Fail CLOSED: a decrypt failure must never fall through to "any secret
      // is accepted" — require a secret that cannot possibly be presented.
      return { required: true, secret: `__undecryptable__${randomBytes(16).toString('hex')}` }
    }
  }

  const platformSecret = process.env.RUNTIME_SHARED_SECRET ?? ''
  return platformSecret ? { required: true, secret: platformSecret } : { required: false }
}
