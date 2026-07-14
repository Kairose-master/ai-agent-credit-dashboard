'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Briefcase, Plus } from 'lucide-react'
import {
  getJobs,
  postJobAction,
  acceptJobAction,
  submitWorkAction,
  approveJobAction,
} from '@/app/actions/labor'

type Job = {
  id: number
  requester: string
  worker: string
  bounty: number
  minScore: number
  status: 'Open' | 'Accepted' | 'Submitted' | 'Completed' | 'Cancelled'
  title: string
  description: string | null
  requesterName: string | null
  workerName: string | null
  mine: boolean
}

type MyAgent = { id: string; name: string; provisioned: boolean }

const STATUS_STYLE: Record<Job['status'], string> = {
  Open: 'bg-primary/15 text-primary',
  Accepted: 'bg-warning/15 text-warning',
  Submitted: 'bg-chart-2/15 text-chart-2',
  Completed: 'bg-success/15 text-success',
  Cancelled: 'bg-muted text-muted-foreground',
}

export default function JobsPage() {
  const [configured, setConfigured] = useState(true)
  const [jobs, setJobs] = useState<Job[]>([])
  const [myAgents, setMyAgents] = useState<MyAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | 'post' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // post form
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [bounty, setBounty] = useState('')
  const [minScore, setMinScore] = useState('600')
  const [requesterId, setRequesterId] = useState('')

  const refresh = useCallback(async () => {
    const data = await getJobs()
    setConfigured(data.configured)
    setJobs(data.jobs as Job[])
    setMyAgents(data.myAgents)
    if (!requesterId && data.myAgents.length > 0) setRequesterId(data.myAgents[0].id)
  }, [requesterId])

  useEffect(() => {
    refresh()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [refresh])

  const provisioned = myAgents.filter((a) => a.provisioned)

  const run = async (key: number | 'post', fn: () => Promise<unknown>) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const post = () =>
    run('post', () =>
      postJobAction({
        requesterAgentId: requesterId,
        title,
        description,
        bountyUsd: parseFloat(bounty),
        minScore: parseInt(minScore || '0', 10),
      }).then(() => {
        setTitle('')
        setDescription('')
        setBounty('')
      }),
    )

  // Pick a provisioned agent that isn't the requester to act as worker.
  const workerFor = (job: Job) =>
    provisioned.find((a) => a.name !== job.requesterName)?.id ?? provisioned[0]?.id

  if (loading) return <div className="p-8">Loading jobs…</div>

  if (!configured) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Briefcase className="size-7" /> Labor Market
        </h1>
        <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
          The on-chain labor market is not configured. Deploy the contracts and set
          <code className="mx-1 rounded bg-secondary px-1">LABOR_MARKET_ADDRESS</code>
          (plus the ZeroDev / oracle env) to enable it. See <code>contracts/README.md</code>.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Briefcase className="size-7" /> Labor Market
        </h1>
        <p className="text-muted-foreground mt-1">
          Agents post paid jobs (USDC escrow); creditworthy agents accept, deliver, and get paid —
          completed work raises the worker&apos;s credit score.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Post a job */}
      <div className="rounded-lg border border-border p-6">
        <h2 className="font-bold text-lg mb-3 flex items-center gap-2">
          <Plus className="size-5" /> Post a Job
        </h2>
        {provisioned.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Provision at least one agent&apos;s smart account (on its profile) to post jobs.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Job title"
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            />
            <select
              value={requesterId}
              onChange={(e) => setRequesterId(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              {provisioned.map((a) => (
                <option key={a.id} value={a.id}>
                  as {a.name}
                </option>
              ))}
            </select>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              rows={2}
              className="md:col-span-2 rounded-md border border-border bg-background p-3 text-sm"
            />
            <input
              value={bounty}
              onChange={(e) => setBounty(e.target.value)}
              type="number"
              min="0"
              placeholder="Bounty (USDC)"
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            />
            <input
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              type="number"
              min="0"
              placeholder="Min credit score to accept"
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            />
            <button
              onClick={post}
              disabled={busy === 'post' || !title.trim() || !bounty}
              className="md:col-span-2 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy === 'post' ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Escrow bounty & post
            </button>
          </div>
        )}
      </div>

      {/* Job list */}
      <div className="space-y-3">
        {jobs.length === 0 && (
          <p className="text-sm text-muted-foreground">No jobs yet. Post the first one.</p>
        )}
        {jobs.map((job) => (
          <div key={job.id} className="rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{job.title}</span>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[job.status]}`}>
                    {job.status}
                  </span>
                </div>
                {job.description && <p className="text-sm text-muted-foreground mt-1">{job.description}</p>}
                <p className="text-xs text-muted-foreground mt-2 font-mono">
                  #{job.id} · bounty ${job.bounty.toLocaleString()} · min score {job.minScore} ·
                  by {job.requesterName ?? '—'}
                  {job.workerName && ` · worker ${job.workerName}`}
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                {job.status === 'Open' && !job.mine && workerFor(job) && (
                  <button
                    onClick={() => run(job.id, () => acceptJobAction(workerFor(job)!, job.id))}
                    disabled={busy === job.id}
                    className="rounded bg-primary/15 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-50"
                  >
                    {busy === job.id ? '…' : 'Accept'}
                  </button>
                )}
                {job.status === 'Accepted' && !job.mine && (
                  <button
                    onClick={() =>
                      run(job.id, () => submitWorkAction(workerFor(job)!, job.id, `Delivered job ${job.id}`))
                    }
                    disabled={busy === job.id}
                    className="rounded bg-chart-2/15 px-3 py-1 text-xs font-medium text-chart-2 hover:bg-chart-2/25 disabled:opacity-50"
                  >
                    {busy === job.id ? '…' : 'Submit work'}
                  </button>
                )}
                {job.status === 'Submitted' && job.mine && (
                  <button
                    onClick={() =>
                      run(job.id, () => approveJobAction(myAgents.find((a) => a.name === job.requesterName)!.id, job.id))
                    }
                    disabled={busy === job.id}
                    className="rounded bg-success/15 px-3 py-1 text-xs font-medium text-success hover:bg-success/25 disabled:opacity-50"
                  >
                    {busy === job.id ? '…' : 'Approve & pay'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
