import { db } from '@/lib/db'
import { jobSpec, agentTask, artifact, agent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Read-only diagnostic: why is a Submitted job not settling? Dumps the spec's
 * grading-relevant fields, its agent task, and its artifact rows (without the
 * base64 payload) so we can see whether the image/audio deliverable is even
 * linked and gradable. Guarded by CRON_SECRET.
 *
 *   GET /api/admin/job-diag?secret=...&job_id=129
 */
export const dynamic = 'force-dynamic'

async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const url = new URL(request.url)
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('secret') ?? ''
  if (given !== secret) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const jobId = Number(url.searchParams.get('job_id'))
  if (!Number.isInteger(jobId)) return Response.json({ error: 'job_id required' }, { status: 400 })

  const [spec] = await db.select().from(jobSpec).where(eq(jobSpec.onchainJobId, jobId))
  if (!spec) return Response.json({ error: `no spec for onchainJobId ${jobId}` }, { status: 404 })

  const [reqAgent] = spec.requesterAgentId
    ? await db.select().from(agent).where(eq(agent.id, spec.requesterAgentId))
    : []
  const [task] = spec.agentTaskId
    ? await db.select().from(agentTask).where(eq(agentTask.id, spec.agentTaskId))
    : []
  const arts = spec.agentTaskId
    ? await db.select().from(artifact).where(eq(artifact.taskId, spec.agentTaskId))
    : []

  // On-chain status too.
  let onchainStatus: string | null = null
  try {
    const { isLaborMarketConfigured } = await import('@/lib/onchain/config')
    if (isLaborMarketConfigured()) {
      const { readJobs } = await import('@/lib/onchain/labor')
      onchainStatus = (await readJobs()).find((j) => j.id === jobId)?.status ?? null
    }
  } catch { /* ignore */ }

  return Response.json({
    jobId,
    onchainStatus,
    spec: {
      title: spec.title,
      deliverableKind: spec.deliverableKind,
      hasTestCode: Boolean(spec.testCode),
      hasAcceptanceCriteria: Boolean(spec.acceptanceCriteria?.trim()),
      agentTaskId: spec.agentTaskId,
      requesterAgentId: spec.requesterAgentId,
      workerAgentId: spec.workerAgentId,
      autoApprove: spec.autoApprove,
      testResult: spec.testResult, // { passed, output, gradedAt } or null
    },
    requesterOwner: reqAgent ? { agentName: reqAgent.name, userId: reqAgent.userId } : null,
    task: task
      ? { id: task.id, status: task.status, hasOutput: Boolean(task.output), outputLen: (task.output ?? '').length }
      : null,
    artifacts: arts.map((a) => ({
      id: a.id,
      mime: a.mime,
      name: a.name,
      hasBase64: Boolean(a.dataBase64),
      url: a.url,
      urlHost: a.url ? (() => { try { return new URL(a.url!).host } catch { return 'invalid' } })() : null,
      size: a.size,
    })),
  })
}

export const GET = handle
export const POST = handle
