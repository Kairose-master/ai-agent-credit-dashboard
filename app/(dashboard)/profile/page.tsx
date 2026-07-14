'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Wallet,
  CalendarDays,
  Cpu,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  ListChecks,
  Wrench,
  Sparkles,
  Banknote,
  HandCoins,
} from 'lucide-react'
import { getAgents } from '@/app/actions/agents'
import { drawCredit, repayCredit, getCreditDraws } from '@/app/actions/credit'
import { CreditEvolutionChart } from '@/components/charts'

type CreditState = {
  score: number
  rating: string
  creditLimit: number
  riskLevel: string
}

type AgentProfile = {
  identity: {
    id: string
    name: string
    description: string | null
    walletAddress: string
    modelVersion: string | null
    createdAt: string
  }
  performance: {
    totalTasks: number
    completedTasks: number
    failedTasks: number
    successRate: number | null
    avgQuality: number | null
    totalTokenCost: number
  }
  credit: CreditState & { availableCredit: number }
}

type AgentEvent = {
  id: string
  taskId: string
  eventType: string
  success: boolean
  executionTime: number
  tokenCost: number
  qualityScore: number | null
  detail: Record<string, unknown>
  createdAt: string
}

type CreditHistoryEntry = {
  id: string
  score: number
  rating: string
  creditLimit: number
  riskLevel: string
  calculationReason: string
  createdAt: string
}

type TaskResult = {
  status: 'running' | 'processing' | 'completed' | 'failed'
  output: string | null
  result: {
    success: boolean
    plan: string
    qualityScore: number
    executionTime: number
    tokenCost: number
  } | null
  credit: (CreditState & { previousScore: number | null; calculationReason: string }) | null
  error: string | null
}

type Draw = { id: string; amount: string; description: string | null; createdAt: string }

const EVENT_META: Record<string, { label: string; Icon: typeof Play }> = {
  TASK_STARTED: { label: 'Task started', Icon: Play },
  PLAN_CREATED: { label: 'Execution plan created', Icon: ListChecks },
  TOOL_EXECUTED: { label: 'Tool executed', Icon: Wrench },
  TASK_COMPLETED: { label: 'Task completed', Icon: CheckCircle2 },
  TASK_FAILED: { label: 'Task failed', Icon: XCircle },
  ACHIEVEMENT_VERIFIED: { label: 'Achievement verified', Icon: Sparkles },
  REPAYMENT_COMPLETED: { label: 'Credit repaid', Icon: HandCoins },
}

export default function ProfilePage() {
  const [agentId, setAgentId] = useState<string | null>(null)
  const [profile, setProfile] = useState<AgentProfile | null>(null)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [history, setHistory] = useState<CreditHistoryEntry[]>([])
  const [draws, setDraws] = useState<Draw[]>([])
  const [loading, setLoading] = useState(true)

  const [task, setTask] = useState('')
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<TaskResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const [drawAmount, setDrawAmount] = useState('')
  const [creditBusy, setCreditBusy] = useState(false)
  const [creditError, setCreditError] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async (id: string) => {
    const [profileRes, eventsRes, historyRes, drawsData] = await Promise.all([
      fetch(`/api/agents/${id}`),
      fetch(`/api/agents/${id}/events?limit=30`),
      fetch(`/api/agents/${id}/credit-history`),
      getCreditDraws(id).catch(() => []),
    ])
    if (profileRes.ok) setProfile(await profileRes.json())
    if (eventsRes.ok) setEvents((await eventsRes.json()).events)
    if (historyRes.ok) setHistory((await historyRes.json()).history)
    setDraws(drawsData as Draw[])
  }, [])

  useEffect(() => {
    const init = async () => {
      try {
        const agents = await getAgents()
        if (agents.length > 0) {
          setAgentId(agents[0].id)
          await refresh(agents[0].id)
        }
      } catch (error) {
        console.error('[v0] Error:', error)
      } finally {
        setLoading(false)
      }
    }
    init()
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [refresh])

  const pollTask = useCallback(
    (id: string, taskId: string) => {
      const tick = async () => {
        try {
          const res = await fetch(`/api/agents/${id}/tasks/${taskId}`)
          if (!res.ok) throw new Error(`Poll failed (${res.status})`)
          const data: TaskResult = await res.json()
          setLastRun(data)
          if (data.status === 'completed' || data.status === 'failed') {
            setRunning(false)
            await refresh(id)
            return
          }
          pollRef.current = setTimeout(tick, 2500)
        } catch (error) {
          setRunError(error instanceof Error ? error.message : String(error))
          setRunning(false)
        }
      }
      pollRef.current = setTimeout(tick, 2000)
    },
    [refresh],
  )

  const runTask = async () => {
    if (!agentId || !task.trim() || running) return
    setRunning(true)
    setRunError(null)
    setLastRun(null)
    try {
      const response = await fetch(`/api/agents/${agentId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: task.trim() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
      setTask('')
      pollTask(agentId, data.taskId)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
      setRunning(false)
    }
  }

  const handleDraw = async () => {
    if (!agentId || creditBusy) return
    const amount = parseFloat(drawAmount)
    setCreditBusy(true)
    setCreditError(null)
    try {
      await drawCredit(agentId, amount, 'Manual credit draw')
      setDrawAmount('')
      await refresh(agentId)
    } catch (error) {
      setCreditError(error instanceof Error ? error.message : String(error))
    } finally {
      setCreditBusy(false)
    }
  }

  const handleRepay = async (txId: string) => {
    if (!agentId || creditBusy) return
    setCreditBusy(true)
    setCreditError(null)
    try {
      await repayCredit(txId)
      await refresh(agentId)
    } catch (error) {
      setCreditError(error instanceof Error ? error.message : String(error))
    } finally {
      setCreditBusy(false)
    }
  }

  if (loading) return <div className="p-8">Loading...</div>
  if (!agentId || !profile) return <div className="p-8">No agent found</div>

  const { identity, performance, credit } = profile
  const evolution = [...history]
    .reverse()
    .map((entry) => ({
      label: new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      score: entry.score,
    }))
  const outstanding = draws.reduce((sum, d) => sum + parseFloat(d.amount), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Agent Credit Profile</h1>
        <p className="text-muted-foreground">
          Identity → Behavior → Reputation → Credit Score → Credit Capacity
        </p>
      </div>

      {/* Credit profile banner */}
      <div className="border border-border rounded-lg p-6">
        <div className="flex flex-col md:flex-row md:items-start gap-6">
          <div className="flex-1">
            <h2 className="text-2xl font-bold">{identity.name}</h2>
            <p className="text-sm text-muted-foreground mt-1">{identity.description}</p>
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Wallet className="size-3.5" />
                <span className="font-mono">{identity.walletAddress.slice(0, 10)}…{identity.walletAddress.slice(-6)}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Cpu className="size-3.5" />
                {identity.modelVersion ?? 'claude-sonnet-5'}
              </span>
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-3.5" />
                {new Date(identity.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            <div>
              <p className="text-3xl font-bold font-mono">{credit.score}</p>
              <p className="text-xs text-muted-foreground mt-1">Credit Score</p>
            </div>
            <div>
              <p className="text-3xl font-bold">{credit.rating}</p>
              <p className="text-xs text-muted-foreground mt-1">Credit Rating</p>
            </div>
            <div>
              <p className="text-3xl font-bold font-mono">${credit.creditLimit.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-1">Credit Limit</p>
            </div>
            <div>
              <p className="text-3xl font-bold">{credit.riskLevel}</p>
              <p className="text-xs text-muted-foreground mt-1">Risk Level</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-4 border-t border-border text-sm">
          <div>
            <span className="text-muted-foreground">Tasks completed</span>{' '}
            <span className="font-mono font-semibold">{performance.completedTasks}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Success rate</span>{' '}
            <span className="font-mono font-semibold">
              {performance.successRate === null ? '—' : `${(performance.successRate * 100).toFixed(1)}%`}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Avg quality</span>{' '}
            <span className="font-mono font-semibold">
              {performance.avgQuality === null ? '—' : `${(performance.avgQuality * 100).toFixed(0)}%`}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Token cost</span>{' '}
            <span className="font-mono font-semibold">{performance.totalTokenCost.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Task runner — the entry point of the vertical slice */}
      <div className="border border-border rounded-lg p-6">
        <h3 className="font-bold text-lg mb-1">Run a Task</h3>
        <p className="text-sm text-muted-foreground mb-4">
          The Claude-powered research agent executes the task; its behavior is recorded as events
          and the credit score is recalculated automatically.
        </p>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="e.g. Research the main differences between optimistic and ZK rollups and summarize them."
          rows={3}
          className="w-full rounded-md border border-border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={running}
        />
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-muted-foreground">
            {running
              ? lastRun?.status === 'processing'
                ? 'Recording events and recalculating credit…'
                : 'Agent is planning, executing tools, and self-evaluating…'
              : ' '}
          </p>
          <button
            onClick={runTask}
            disabled={running || !task.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {running ? 'Running…' : 'Execute Task'}
          </button>
        </div>

        {runError && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {runError}
          </div>
        )}

        {lastRun && (lastRun.status === 'completed' || lastRun.status === 'failed') && (
          <div className="mt-4 space-y-3">
            <div className="rounded-md border border-border p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {lastRun.result?.success ? (
                  <CheckCircle2 className="size-4 text-success" />
                ) : (
                  <XCircle className="size-4 text-destructive" />
                )}
                {lastRun.result?.success ? 'Task completed' : 'Task failed'}
                {lastRun.result && (
                  <span className="text-xs font-normal text-muted-foreground font-mono">
                    {lastRun.result.executionTime}s · {lastRun.result.tokenCost.toLocaleString()} tokens ·
                    quality {(lastRun.result.qualityScore * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm whitespace-pre-wrap">{lastRun.output || lastRun.error}</p>
            </div>
            {lastRun.credit && (
              <div className="rounded-md border border-border p-4 text-sm">
                <p className="font-semibold mb-1">Credit update</p>
                <p className="font-mono text-lg">
                  {lastRun.credit.previousScore ?? '—'} → {lastRun.credit.score}{' '}
                  <span className="text-sm">
                    ({lastRun.credit.rating} · ${lastRun.credit.creditLimit.toLocaleString()} limit ·{' '}
                    {lastRun.credit.riskLevel} risk)
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{lastRun.credit.calculationReason}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Credit line — borrow and repay against the earned limit */}
      <div className="border border-border rounded-lg p-6">
        <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
          <Banknote className="size-5" /> Credit Line
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Draw against the credit the agent has earned, then repay it — on-time repayment raises the
          score and unlocks a higher limit.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 text-sm">
          <div>
            <span className="text-muted-foreground">Available</span>{' '}
            <span className="font-mono font-semibold text-success">
              ${Math.round(credit.availableCredit).toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Outstanding</span>{' '}
            <span className="font-mono font-semibold">${Math.round(outstanding).toLocaleString()}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Limit</span>{' '}
            <span className="font-mono font-semibold">${credit.creditLimit.toLocaleString()}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min="0"
            value={drawAmount}
            onChange={(e) => setDrawAmount(e.target.value)}
            placeholder="Amount"
            className="h-9 w-40 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={creditBusy}
          />
          <button
            onClick={handleDraw}
            disabled={creditBusy || !drawAmount || parseFloat(drawAmount) <= 0}
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
          >
            {creditBusy ? <Loader2 className="size-4 animate-spin" /> : <HandCoins className="size-4" />}
            Draw credit
          </button>
        </div>

        {creditError && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {creditError}
          </div>
        )}

        {draws.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Active draws
            </p>
            {draws.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
              >
                <div>
                  <span className="font-mono font-semibold">
                    ${Math.round(parseFloat(d.amount)).toLocaleString()}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {d.description} · {new Date(d.createdAt).toLocaleString()}
                  </span>
                </div>
                <button
                  onClick={() => handleRepay(d.id)}
                  disabled={creditBusy}
                  className="rounded bg-success/15 px-3 py-1 text-xs font-medium text-success hover:bg-success/25 disabled:opacity-50"
                >
                  Repay
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Credit evolution */}
        <div className="border border-border rounded-lg p-6">
          <h3 className="font-bold text-lg mb-4">Credit Evolution</h3>
          {evolution.length > 1 ? (
            <CreditEvolutionChart data={evolution} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Run at least two tasks to see the score evolve.
            </p>
          )}
          <div className="mt-4 space-y-2 max-h-48 overflow-y-auto">
            {history.slice(0, 5).map((entry) => (
              <div key={entry.id} className="text-xs border-t border-border pt-2">
                <span className="font-mono font-semibold">{entry.score}</span>{' '}
                <span className="text-muted-foreground">
                  {entry.rating} · ${entry.creditLimit.toLocaleString()} ·{' '}
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
                <p className="text-muted-foreground mt-0.5">{entry.calculationReason}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Activity timeline */}
        <div className="border border-border rounded-lg p-6">
          <h3 className="font-bold text-lg mb-4">Agent Activity Timeline</h3>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No activity yet — run a task to generate behavioral events.
            </p>
          ) : (
            <ul className="space-y-3 max-h-[420px] overflow-y-auto">
              {events.map((event) => {
                const meta = EVENT_META[event.eventType] ?? { label: event.eventType, Icon: Play }
                return (
                  <li key={event.id} className="flex items-start gap-3 text-sm">
                    <meta.Icon
                      className={`size-4 mt-0.5 shrink-0 ${
                        event.eventType === 'TASK_FAILED'
                          ? 'text-destructive'
                          : event.eventType === 'TASK_COMPLETED' || event.eventType === 'REPAYMENT_COMPLETED'
                            ? 'text-success'
                            : 'text-muted-foreground'
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="font-medium">
                        {meta.label}
                        {event.eventType === 'TOOL_EXECUTED' && event.detail?.tool ? (
                          <span className="font-mono text-xs text-muted-foreground"> · {String(event.detail.tool)}</span>
                        ) : null}
                        {event.qualityScore !== null && event.eventType !== 'REPAYMENT_COMPLETED' && (
                          <span className="font-mono text-xs text-muted-foreground">
                            {' '}· quality {(event.qualityScore * 100).toFixed(0)}%
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {event.taskId} · {new Date(event.createdAt).toLocaleString()}
                        {event.tokenCost > 0 && ` · ${event.tokenCost.toLocaleString()} tokens`}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
