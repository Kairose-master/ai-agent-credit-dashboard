import { db } from '@/lib/db'
import { artifact } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * GET /api/artifacts/:id — serve a submission artifact (image/file) as
 * raw bytes. The unguessable nanoid id is the access token, matching the
 * attachment-URL model used elsewhere. Immutable: artifacts are never
 * edited, so cache hard.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [row] = await db.select().from(artifact).where(eq(artifact.id, id))
  if (!row) return new Response('Not found', { status: 404 })

  const bytes = Buffer.from(row.dataBase64, 'base64')
  return new Response(bytes, {
    headers: {
      'Content-Type': row.mime,
      'Content-Length': String(bytes.length),
      'Content-Disposition': `inline; filename="${row.name.replace(/[^\w.\-]/g, '_')}"`,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
