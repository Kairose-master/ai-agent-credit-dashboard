import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { session, user } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function getSession() {
  try {
    const c = await cookies()
    const sessionId = c.get('auth_session')?.value

    if (!sessionId) return null

    const sess = await db.query.session.findFirst({
      where: (s) => eq(s.id, sessionId),
    })

    if (!sess || new Date(sess.expiresAt) < new Date()) return null

    const u = await db.query.user.findFirst({
      where: (usr) => eq(usr.id, sess.userId),
    })

    if (!u) return null

    return {
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
      },
      session: sess,
    }
  } catch (e) {
    console.error('[v0] Failed to get session:', e)
    return null
  }
}
