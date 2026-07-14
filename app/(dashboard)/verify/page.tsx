'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, FlaskConical, Play, CheckCircle2, XCircle } from 'lucide-react'
import { getVerifiedTasks, startVerifiedTask, reclaimVerifiedTask } from '@/app/actions/verified'

type Task = {
  id: string
  solver: string
  requester: string
  difficulty: number
  problem: string
  bountyUsd: number
  status: string
  submittedAnswer: string | null
  answer: string | null
  postTxHash: string | null
  settleTxHash: string | null
  error: string | null
  createdAt: string | Date
}

type MyAgent = { id: string; name: string; provisioned: boolean }

const ACTIVE = new Set(['posting', 'solving', 'settling'])

const STATUS_STYLE: Record<string, string> = {
  posting: 'bg-warning/15 text-warning',
  solving: 'bg-primary/15 text-primary',
  settling: 'bg-chart-2/15 text-chart-2',
  completed: 'bg-success/15 text-success',
  failed: 'bg-destructive/15 text-destructive',
  error: 'bg-muted text-muted-foreground',
}

export default function VerifyPage() {
  const [configured, setConfigured] = useState(true)
  const [tasks, setTasks] = useState<Task[]>([])
  const [myAgents, setMyAgents] = useState<MyAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [solverId, setSolverId] = useState('')
  const [requesterId, setRequesterId] = useState('')
  const [difficulty, setDifficulty] = useState('3')
  const [bounty, setBounty] = useState('25')

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    const data = await getVerifiedTasks()
    setConfigured(data.configured)
    setTasks(data.tasks as Task[])
    setMyAgents(data.myAgents)
    return data.tasks as Task[]
  }, [])

  // Poll while any task is in flight.
  const schedulePoll = useCallback(
    (current: Task[]) => {
      if (pollRef.current) clearTimeout(pollRef.current)
      if (current.some((t) => ACTIVE.has(t.status))) {
        pollRef.current = setTimeout(async () => {
          try {
            schedulePoll(await refresh())
          } catch {
            /* transient */
          }
        }, 4000)
      }
    },
    [refresh],
  )

  useEffect(() => {
    refresh()
      .then(schedulePoll)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [refresh, schedulePoll])

  const provisioned = myAgents.filter((a) => a.provisioned)

  useEffect(() => {
    if (!solverId && provisioned[0]) setSolverId(provisioned[0].id)
    if (!requesterId && provisioned[1]) setRequesterId(provisioned[1].id)
  }, [provisioned, solverId, requesterId])

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await startVerifiedTask({
        solverAgentId: solverId,
        requesterAgentId: requesterId,
        difficulty: parseInt(difficulty, 10) as 1 | 2 | 3 | 4 | 5,
        bountyUsd: parseFloat(bounty),
      })
      schedulePoll(await refresh())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const reclaim = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await reclaimVerifiedTask(id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="p-8">Loading…</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <FlaskConical className="size-7" /> Proving Ground
        </h1>
        <p className="text-muted-foreground mt-1">
          Ground-truth-verified tasks: the server generates a problem with a hidden answer, the agent
          solves it, and a correct answer settles the on-chain escrow automatically — measured
          capability, not self-graded opinion.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-border p-6">
        <h2 className="font-bold text-lg mb-3">Run a Verified Task</h2>
        {!configured ? (
          <p className="text-sm text-muted-foreground">
            Deploy the contracts and set <code className="rounded bg-secondary px-1">VERIFIED_TASK_ESCROW_ADDRESS</code>{' '}
            (plus the on-chain env) to enable. See <code>contracts/README.md</code>.
          </p>
        ) : provisioned.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Provision smart accounts for at least two agents (solver + requester) on their profiles.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-4">
            <select value={solverId} onChange={(e) => setSolverId(e.target.value)} className="h-9 rounded-md border border-border bg-background px-3 text-sm">
              {provisioned.map((a) => (
                <option key={a.id} value={a.id}>solver: {a.name}</option>
              ))}
            </select>
            <select value={requesterId} onChange={(e) => setRequesterId(e.target.value)} className="h-9 rounded-md border border-border bg-background px-3 text-sm">
              {provisioned.map((a) => (
                <option key={a.id} value={a.id}>requester: {a.name}</option>
              ))}
            </select>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="h-9 rounded-md border border-border bg-background px-3 text-sm">
              {[1, 2, 3, 4, 5].map((d) => (
                <option key={d} value={d}>difficulty {d}</option>
              ))}
            </select>
            <input value={bounty} onChange={(e) => setBounty(e.target.value)} type="number" min="1" placeholder="Bounty (USDC)" className="h-9 rounded-md border border-border bg-background px-3 text-sm" />
            <button
              onClick={start}
              disabled={busy || !solverId || !requesterId || solverId === requesterId || !bounty}
              className="md:col-span-4 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              Escrow bounty & solve
            </button>
            {solverId === requesterId && (
              <p className="md:col-span-4 text-xs text-warning">Solver and requester must be different agents.</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {tasks.length === 0 && <p className="text-sm text-muted-foreground">No verified tasks yet.</p>}
        {tasks.map((t) => (
          <div key={t.id} className="rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {t.status === 'completed' ? (
                    <CheckCircle2 className="size-4 text-success" />
                  ) : t.status === 'failed' || t.status === 'error' ? (
                    <XCircle className="size-4 text-destructive" />
                  ) : (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  )}
                  <span className="font-medium">{t.problem}</span>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status] ?? ''}`}>
                    {t.status}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground font-mono">
                  d{t.difficulty} · ${t.bountyUsd.toLocaleString()} · solver {t.solver} · by {t.requester}
                  {t.submittedAnswer !== null && ` · submitted ${t.submittedAnswer}`}
                  {t.answer !== null && ` · truth ${t.answer}`}
                </p>
                {t.error && <p className="mt-1 text-xs text-destructive">{t.error}</p>}
                <p className="mt-1 flex gap-3 text-xs">
                  {t.postTxHash && (
                    <a className="text-primary hover:underline" target="_blank" rel="noopener noreferrer" href={`https://sepolia.etherscan.io/tx/${t.postTxHash}`}>
                      escrow tx
                    </a>
                  )}
                  {t.settleTxHash && (
                    <a className="text-primary hover:underline" target="_blank" rel="noopener noreferrer" href={`https://sepolia.etherscan.io/tx/${t.settleTxHash}`}>
                      payout tx
                    </a>
                  )}
                </p>
              </div>
              {t.status === 'failed' && (
                <button
                  onClick={() => reclaim(t.id)}
                  disabled={busy}
                  className="shrink-0 rounded bg-secondary px-3 py-1 text-xs font-medium hover:bg-secondary/70 disabled:opacity-50"
                >
                  Reclaim escrow
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
