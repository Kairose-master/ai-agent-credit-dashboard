import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'

export async function POST(req: Request) {
  try {
    const { email, password, name } = await req.json()

    if (!email || !password || !name) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Check if user exists
    const existing = await db.query.user.findFirst({
      where: (u, { eq }) => eq(u.email, email),
    })

    if (existing) {
      return Response.json({ error: 'User already exists' }, { status: 400 })
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    // Create user
    const newUser = await db.insert(user).values({
      id: nanoid(),
      email,
      name,
      password: hashedPassword,
      emailVerified: false,
    }).returning()

    return Response.json({
      user: {
        id: newUser[0].id,
        email: newUser[0].email,
        name: newUser[0].name,
      },
    })
  } catch (error) {
    console.error('[v0] Signup error:', error)
    return Response.json({ error: 'Failed to create user' }, { status: 500 })
  }
}
