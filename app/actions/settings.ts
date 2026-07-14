'use server'

import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { userApiKey } from '@/lib/db/schema'
import { encryptSecret } from '@/lib/crypto'
import { eq } from 'drizzle-orm'

async function requireUser() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

/** Key presence + display hint only — the key itself never leaves the server. */
export async function getApiKeyStatus() {
  const userId = await requireUser()
  const [row] = await db.select().from(userApiKey).where(eq(userApiKey.userId, userId))
  return { hasKey: Boolean(row), hint: row?.keyHint ?? null, updatedAt: row?.updatedAt ?? null }
}

export async function saveAnthropicKey(key: string) {
  const userId = await requireUser()
  const trimmed = key.trim()
  if (!trimmed.startsWith('sk-ant-') || trimmed.length < 20) {
    throw new Error('That does not look like an Anthropic API key (sk-ant-…)')
  }

  const values = {
    anthropicKeyEnc: encryptSecret(trimmed),
    keyHint: trimmed.slice(-4),
    updatedAt: new Date(),
  }
  await db
    .insert(userApiKey)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userApiKey.userId, set: values })

  return { hint: values.keyHint }
}

export async function removeAnthropicKey() {
  const userId = await requireUser()
  await db.delete(userApiKey).where(eq(userApiKey.userId, userId))
}
