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
  | { required: true; secret: string; alsoAccept: string } // transition: per-agent key preferred, legacy shared secret tolerated

/** Does a presented callback secret satisfy this agent's auth? Constant
 *  shape for every runtime type — call sites stop caring which kind of
 *  worker produced the callback. */
export function callbackSecretMatches(auth: CallbackAuth, presented: string | null): boolean {
  if (!auth.required) return true
  if (presented === null) return false
  if (presented === auth.secret) return true
  return 'alsoAccept' in auth && presented === auth.alsoAccept
}

/** What an incoming callback for this agent's task must present to be
 *  authentic. Applies to 'webhook' agents (their server calls us back),
 *  'local' agents (their worker polls us and calls back), 'cloud' agents (we
 *  call the owner's cloud API key ourselves, then call our own callback the
 *  same way a webhook would), AND 'mcp' agents (same shape as cloud — we call
 *  the external MCP tool, then our own callback) — all use the per-agent
 *  secret, never the platform-wide one. */
export async function resolveCallbackAuth(agentId: string): Promise<CallbackAuth> {
  const [ag] = await db.select().from(agent).where(eq(agent.id, agentId))

  if (ag?.webhookSecretEnc) {
    try {
      const perAgent = decryptSecret(ag.webhookSecretEnc)
      // 'platform' agents live in a transition: the external Python runtime
      // still presents the shared secret it was configured with, so both are
      // accepted until STRICT_AGENT_KEYS=true. Every OTHER runtime type has
      // always been strict per-agent and stays that way.
      const isPlatform = (ag.runtimeType ?? 'platform') === 'platform'
      const shared = process.env.RUNTIME_SHARED_SECRET ?? ''
      if (isPlatform && shared && process.env.STRICT_AGENT_KEYS !== 'true') {
        return { required: true, secret: perAgent, alsoAccept: shared }
      }
      return { required: true, secret: perAgent }
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
