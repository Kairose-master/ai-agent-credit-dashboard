import { db } from '@/lib/db'
import { userApiKey } from '@/lib/db/schema'
import { decryptSecret } from '@/lib/crypto'
import { eq } from 'drizzle-orm'

/**
 * Resolve the Anthropic key an agent run should bill.
 * BYOK: the owner's stored key wins; otherwise fall back to the platform key
 * configured on the runtime — unless REQUIRE_USER_API_KEY=true, in which case
 * users must bring their own.
 */
export async function resolveUserAnthropicKey(userId: string): Promise<string | null> {
  const [row] = await db.select().from(userApiKey).where(eq(userApiKey.userId, userId))
  if (row) {
    try {
      return decryptSecret(row.anthropicKeyEnc)
    } catch (error) {
      console.error('[user-keys] decrypt failed (was API_KEY_ENCRYPTION_SECRET rotated?):', error)
      throw new Error('Stored API key could not be read — please re-enter it in Settings')
    }
  }
  if (process.env.REQUIRE_USER_API_KEY === 'true') {
    throw new Error('Add your Anthropic API key in Settings to run agent tasks')
  }
  return null // runtime falls back to its own ANTHROPIC_API_KEY
}
