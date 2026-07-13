import { db } from '@/lib/db'
import { user, session } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'
import { cookies } from 'next/headers'

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return Response.json({ error: 'Missing email or password' }, { status: 400 })
    }

    // Find user
    const u = await db.query.user.findFirst({
      where: (users) => eq(users.email, email),
    })

    if (!u) {
      return Response.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // Verify password
    if (!u.password || !(await bcrypt.compare(password, u.password))) {
      return Response.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // Create session
    const sessionId = nanoid()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    await db.insert(session).values({
      id: sessionId,
      userId: u.id,
      token: nanoid(),
      expiresAt,
    })

    // Set session cookie
    const c = await cookies()
    c.set('auth_session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
    })

    return Response.json({
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
      },
    })
  } catch (error) {
    console.error('[v0] Signin error:', error)
    return Response.json({ error: 'Failed to sign in' }, { status: 500 })
  }
}
