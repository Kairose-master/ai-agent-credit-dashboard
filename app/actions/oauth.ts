'use server'

import { db } from '@/lib/db'
import { oauthClient, oauthCode, user } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import bcrypt from 'bcryptjs'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/get-session'

const CODE_TTL_MS = 10 * 60 * 1000

/**
 * The Approve button on /oauth/authorize. Identity comes from the live
 * dashboard session when there is one, otherwise from email+password
 * entered directly on the consent screen (verified against the same
 * bcrypt hash the sign-in form uses — nothing new is stored).
 */
export async function approveConnector(formData: FormData): Promise<{ error: string } | void> {
  const clientId = String(formData.get('client_id') ?? '')
  const redirectUri = String(formData.get('redirect_uri') ?? '')
  const state = String(formData.get('state') ?? '')
  const codeChallenge = String(formData.get('code_challenge') ?? '')
  const scope = String(formData.get('scope') ?? 'mcp') || 'mcp'

  const [client] = await db.select().from(oauthClient).where(eq(oauthClient.id, clientId))
  if (!client) return { error: 'Unknown connector (client_id not registered)' }
  if (!client.redirectUris.includes(redirectUri)) return { error: 'redirect_uri is not registered for this connector' }
  if (!codeChallenge) return { error: 'Missing PKCE challenge — the connector must use S256' }

  let userId: string | null = null
  const session = await getSession()
  if (session?.user) {
    userId = session.user.id
  } else {
    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const password = String(formData.get('password') ?? '')
    if (!email || !password) return { error: 'Sign in to approve: email and password required' }
    const [u] = await db.select({ id: user.id, password: user.password }).from(user).where(eq(user.email, email))
    if (!u?.password || !(await bcrypt.compare(password, u.password))) {
      return { error: 'Invalid credentials' }
    }
    userId = u.id
  }

  const code = `mcpa_${nanoid(32)}`
  await db.insert(oauthCode).values({
    code,
    clientId,
    userId,
    redirectUri,
    codeChallenge,
    scope,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  })

  const target = new URL(redirectUri)
  target.searchParams.set('code', code)
  if (state) target.searchParams.set('state', state)
  redirect(target.toString())
}
