'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
  Link2,
  ExternalLink,
  Send,
  Copy,
  Coins,
  ChevronsUpDown,
  Webhook,
  RefreshCw,
  Scale,
} from 'lucide-react'
import { getAgents } from '@/app/actions/agents'
import { drawCredit, repayCredit, getCreditDraws } from '@/app/actions/credit'
import { getTreasury, sendFromTreasury, mintTestUsdc } from '@/app/actions/treasury'
import { getWebhookConfig, setWebhookUrl, switchToPlatformRuntime, generateAgentWebhookSecret } from '@/app/actions/webhook'
import {
  getOnchainInfo,
  provisionSmartAccount,
  drawOnchain,
  repayOnchain,
} from '@/app/actions/onchain'
import { getBalanceSheet, type BalanceSheet } from '@/app/actions/balance-sheet'
import { CreditEvolutionChart } from '@/components/charts'
import { LiveTaskProgress } from '@/components/live-task-progress'

type OnchainInfo = {
  configured: boolean
  agentConfigured: boolean
  smartAccountAddress: string | null
  available: number | null
  outstanding: number | null
  explorer: string
}

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
  taskId?: string
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
  VERIFIED_TASK_COMPLETED: { label: 'Verified task passed', Icon: CheckCircle2 },
  VERIFIED_TASK_FAILED: { label: 'Verified task failed', Icon: XCircle },
  WALLET_TRANSFER: { label: 'Wallet transfer', Icon: Send },
  WALLET_MINT: { label: 'Test USDC minted', Icon: Coins },
}

type Treasury = {
  configured: boolean
  address: string | null
  usdc: number | null
  spent24h: number
  maxPerTx: number
  dailyCap: number
}

export default function ProfilePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [agentId, setAgentId] = useState<string | null>(null)
  const [allAgents, setAllAgents] = useState<{ id: string; name: string }[]>([])
  const [profile, setProfile] = useState<AgentProfile | null>(null)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [history, setHistory] = useState<CreditHistoryEntry[]>([])
  const [draws, setDraws] = useState<Draw[]>([])
  const [loading, setLoading] = useState(true)

  const [task, setTask] = useState('')
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<TaskResult | null>(null)
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const [drawAmount, setDrawAmount] = useState('')
  const [creditBusy, setCreditBusy] = useState(false)
  const [creditError, setCreditError] = useState<string | null>(null)

  const [onchain, setOnchain] = useState<OnchainInfo | null>(null)
  const [lastTxHash, setLastTxHash] = useState<string | null>(null)

  const [treasury, setTreasury] = useState<Treasury | null>(null)
  const [sendTo, setSendTo] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [treasuryBusy, setTreasuryBusy] = useState(false)
  const [treasuryMsg, setTreasuryMsg] = useState<string | null>(null)

  const [balanceSheet, setBalanceSheet] = useState<BalanceSheet | null>(null)

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async (id: string) => {
    const [profileRes, eventsRes, historyRes, drawsData, onchainData] = await Promise.all([
      fetch(`/api/agents/${id}`),
      fetch(`/api/agents/${id}/events?limit=30`),
      fetch(`/api/agents/${id}/credit-history`),
      getCreditDraws(id).catch(() => []),
      getOnchainInfo(id).catch(() => null),
    ])
    if (profileRes.ok) setProfile(await profileRes.json())
    if (eventsRes.ok) setEvents((await eventsRes.json()).events)
    if (historyRes.ok) setHistory((await historyRes.json()).history)
    setDraws(drawsData as Draw[])
    setOnchain(onchainData as OnchainInfo | null)
    setTreasury(await getTreasury(id).catch(() => null))
    setBalanceSheet(await getBalanceSheet(id).catch(() => null))
  }, [])

  const handleSend = async () => {
    if (!agentId || treasuryBusy) return
    setTreasuryBusy(true)
    setTreasuryMsg(null)
    try {
      const { txHash } = await sendFromTreasury(agentId, sendTo.trim(), parseFloat(sendAmount))
      setTreasuryMsg(`Sent — tx ${txHash.slice(0, 14)}…`)
      setSendTo('')
      setSendAmount('')
      await refresh(agentId)
    } catch (error) {
      setTreasuryMsg(error instanceof Error ? error.message : String(error))
    } finally {
      setTreasuryBusy(false)
    }
  }

  const [mintAmount, setMintAmount] = useState('1000')
  const [mintBusy, setMintBusy] = useState(false)

  const handleMint = async () => {
    if (!agentId || mintBusy) return
    setMintBusy(true)
    setTreasuryMsg(null)
    try {
      const { txHash } = await mintTestUsdc(agentId, parseFloat(mintAmount))
      setTreasuryMsg(`Minted ${mintAmount} test USDC — tx ${txHash.slice(0, 14)}…`)
      await refresh(agentId)
    } catch (error) {
      setTreasuryMsg(error instanceof Error ? error.message : String(error))
    } finally {
      setMintBusy(false)
    }
  }

  const onchainReady = Boolean(onchain?.agentConfigured && onchain?.smartAccountAddress)

  useEffect(() => {
    const init = async () => {
      try {
        const agents = await getAgents()
        setAllAgents(agents.map((a: any) => ({ id: a.id, name: a.name })))
        if (agents.length > 0) {
          const requested = searchParams.get('agent')
          const target = agents.find((a: any) => a.id === requested) ?? agents[0]
          setAgentId(target.id)
          await refresh(target.id)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, searchParams])

  const switchAgent = async (id: string) => {
    if (id === agentId) return
    router.replace(`/profile?agent=${id}`, { scroll: false })
    setAgentId(id)
    setLoading(true)
    setLastRun(null)
    await refresh(id)
    setLoading(false)
  }

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
      setRunningTaskId(data.taskId)
      pollTask(agentId, data.taskId)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
      setRunning(false)
    }
  }

  const handleProvision = async () => {
    if (!agentId || creditBusy) return
    setCreditBusy(true)
    setCreditError(null)
    try {
      await provisionSmartAccount(agentId)
      await refresh(agentId)
    } catch (error) {
      setCreditError(error instanceof Error ? error.message : String(error))
    } finally {
      setCreditBusy(false)
    }
  }

  const handleDraw = async () => {
    if (!agentId || creditBusy) return
    const amount = parseFloat(drawAmount)
    setCreditBusy(true)
    setCreditError(null)
    setLastTxHash(null)
    try {
      if (onchainReady) {
        const { txHash } = await drawOnchain(agentId, amount, 'On-chain credit draw')
        setLastTxHash(txHash)
      } else {
        await drawCredit(agentId, amount, 'Manual credit draw')
      }
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
    setLastTxHash(null)
    try {
      if (onchainReady) {
        const { txHash } = await repayOnchain(txId)
        setLastTxHash(txHash)
      } else {
        await repayCredit(txId)
      }
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Agent Credit Profile</h1>
          <p className="text-muted-foreground">
            Identity → Behavior → Reputation → Credit Score → Credit Capacity
          </p>
        </div>
        {allAgents.length > 1 && (
          <div className="relative">
            <select
              value={agentId ?? ''}
              onChange={(e) => switchAgent(e.target.value)}
              className="h-10 appearance-none rounded-md border border-border bg-background pl-3 pr-9 text-sm font-medium"
            >
              {allAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        )}
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
          {credit.rating === 'unrated' ? (
            <div className="rounded-lg border border-dashed border-border px-6 py-4 text-center">
              <p className="text-sm font-medium">No credit history yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Run a task below (or draw and repay credit) to generate the agent&apos;s first score.
              </p>
            </div>
          ) : (
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
          )}
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

      {/* Financial statement — the agent's balance sheet, same lens used to evaluate a company */}
      {balanceSheet && <BalanceSheetCard sheet={balanceSheet} />}

      {/* Runtime — platform Claude runtime, or bring your own agent */}
      {agentId && <RuntimeCard agentId={agentId} />}

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

        <LiveTaskProgress taskId={runningTaskId} active={running} />

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

      {/* On-chain layer (ERC-4337 · EAS · Sepolia) */}
      {onchain?.configured && (
        <div className="border border-border rounded-lg p-6">
          <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
            <Link2 className="size-5" /> On-Chain (Sepolia)
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            The credit limit is published to the on-chain registry and attested via EAS; draws and
            repayments settle as real USDC through the agent&apos;s ERC-4337 smart account.
          </p>

          {onchain.smartAccountAddress ? (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Smart account</span>
                <a
                  href={`${onchain.explorer}/address/${onchain.smartAccountAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                >
                  {onchain.smartAccountAddress.slice(0, 12)}…{onchain.smartAccountAddress.slice(-8)}
                  <ExternalLink className="size-3" />
                </a>
                {!onchain.agentConfigured && (
                  <span className="text-xs text-warning">(read-only — bundler not configured)</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-muted-foreground">On-chain available</span>{' '}
                  <span className="font-mono font-semibold text-success">
                    {onchain.available === null ? '—' : `$${Math.round(onchain.available).toLocaleString()}`}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">On-chain outstanding</span>{' '}
                  <span className="font-mono font-semibold">
                    {onchain.outstanding === null ? '—' : `$${Math.round(onchain.outstanding).toLocaleString()}`}
                  </span>
                </div>
              </div>
              {onchainReady && (
                <p className="text-xs text-success">
                  Draws & repayments below execute on-chain as USDC UserOps.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                This agent has no smart account yet.
              </p>
              <button
                onClick={handleProvision}
                disabled={creditBusy || !onchain.agentConfigured}
                className="inline-flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {creditBusy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                Provision smart account
              </button>
              {!onchain.agentConfigured && (
                <p className="text-xs text-warning">
                  Set ZERODEV_RPC and AGENT_OWNER_PRIVATE_KEY to enable provisioning.
                </p>
              )}
            </div>
          )}

          {lastTxHash && (
            <a
              href={`${onchain.explorer}/tx/${lastTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Latest tx: {lastTxHash.slice(0, 14)}… <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}

      {/* Credit line — borrow and repay against the earned limit */}
      <div className="border border-border rounded-lg p-6">
        <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
          <Banknote className="size-5" /> Credit Line
          {onchainReady && <span className="text-xs font-normal text-success">· on-chain</span>}
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

      {/* Treasury — the agent's external-facing wallet */}
      {treasury?.configured && (
        <div className="border border-border rounded-lg p-6">
          <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
            <Send className="size-5" /> Treasury
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            The agent&apos;s on-chain wallet. Deposit by sending USDC to the address below; the agent
            can also pay external addresses itself mid-task (send_usdc tool), within spending caps.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mb-4">
            <div>
              <span className="text-muted-foreground">USDC balance</span>{' '}
              <span className="font-mono font-semibold">
                {treasury.usdc === null ? '—' : `$${treasury.usdc.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Spent (24h)</span>{' '}
              <span className="font-mono font-semibold">${treasury.spent24h.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Caps</span>{' '}
              <span className="font-mono font-semibold">
                ${treasury.maxPerTx}/tx · ${treasury.dailyCap}/day
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-4 text-xs">
            <span className="text-muted-foreground">Deposit address</span>
            <code className="rounded bg-secondary px-2 py-1 font-mono">{treasury.address}</code>
            <button
              onClick={() => navigator.clipboard?.writeText(treasury.address ?? '')}
              className="rounded border border-border p-1 hover:bg-secondary"
              aria-label="Copy address"
            >
              <Copy className="size-3.5" />
            </button>
          </div>

          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Get test USDC (Sepolia testnet — free, not real money)
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min="0"
                max="5000"
                value={mintAmount}
                onChange={(e) => setMintAmount(e.target.value)}
                className="h-9 w-32 rounded-md border border-border bg-background px-3 text-sm"
                disabled={mintBusy}
              />
              <button
                onClick={handleMint}
                disabled={mintBusy || !mintAmount || parseFloat(mintAmount) <= 0}
                className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
              >
                {mintBusy ? <Loader2 className="size-4 animate-spin" /> : <Coins className="size-4" />}
                Mint test USDC
              </button>
            </div>
          </div>

          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Send USDC
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={sendTo}
              onChange={(e) => setSendTo(e.target.value)}
              placeholder="Recipient 0x…"
              className="h-9 w-72 rounded-md border border-border bg-background px-3 font-mono text-sm"
              disabled={treasuryBusy}
            />
            <input
              type="number"
              min="0"
              value={sendAmount}
              onChange={(e) => setSendAmount(e.target.value)}
              placeholder="USDC"
              className="h-9 w-28 rounded-md border border-border bg-background px-3 text-sm"
              disabled={treasuryBusy}
            />
            <button
              onClick={handleSend}
              disabled={treasuryBusy || !sendTo.trim() || !sendAmount}
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
            >
              {treasuryBusy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send USDC
            </button>
          </div>
          {treasuryMsg && <p className="mt-3 text-sm text-muted-foreground">{treasuryMsg}</p>}
        </div>
      )}

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

/**
 * The agent's balance sheet — the same lens used to evaluate a company,
 * applied to an agent. Every figure is a real read (on-chain balance, vault
 * headroom, escrowed-but-unreleased bounties, cumulative draws) — nothing
 * here is inferred or estimated. Net Worth subtracts only Outstanding Debt
 * (what's currently owed); Borrowed Credit (lifetime total drawn) is shown
 * for context but isn't subtracted again, or repaid amounts would be
 * double-counted against the agent.
 */
function BalanceSheetCard({ sheet }: { sheet: BalanceSheet }) {
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`
  const assetsTotal = sheet.assets.usdc + sheet.assets.creditLine + sheet.assets.receivables

  if (!sheet.configured) {
    return (
      <div className="border border-border rounded-lg p-6">
        <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
          <Scale className="size-5" /> Financial Statement
        </h3>
        <p className="text-sm text-muted-foreground">
          Provision this agent&apos;s smart account to see its balance sheet.
        </p>
      </div>
    )
  }

  return (
    <div className="border border-border rounded-lg p-6">
      <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
        <Scale className="size-5" /> Financial Statement
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        The agent evaluated the way a company would be — assets, liabilities, and what&apos;s left over.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Assets</p>
          <dl className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">USDC</dt>
              <dd className="font-mono font-semibold">{fmt(sheet.assets.usdc)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Credit Line (undrawn)</dt>
              <dd className="font-mono font-semibold">{fmt(sheet.assets.creditLine)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Receivables</dt>
              <dd className="font-mono font-semibold">{fmt(sheet.assets.receivables)}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-1.5 mt-1.5">
              <dt className="font-medium">Total Assets</dt>
              <dd className="font-mono font-bold">{fmt(assetsTotal)}</dd>
            </div>
          </dl>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Liabilities</p>
          <dl className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Outstanding Debt</dt>
              <dd className="font-mono font-semibold text-destructive">{fmt(sheet.liabilities.outstandingDebt)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Borrowed Credit (lifetime)</dt>
              <dd className="font-mono text-muted-foreground">{fmt(sheet.liabilities.borrowedLifetime)}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-1.5 mt-1.5">
              <dt className="font-medium">Total Liabilities</dt>
              <dd className="font-mono font-bold text-destructive">{fmt(sheet.liabilities.outstandingDebt)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
        <span className="font-semibold">Net Worth</span>
        <span className={`font-mono text-xl font-bold ${sheet.netWorth >= 0 ? 'text-success' : 'text-destructive'}`}>
          {fmt(sheet.netWorth)}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">
        Assets − Outstanding Debt. Borrowed Credit is informational (lifetime drawn, including repaid
        amounts) and isn&apos;t subtracted separately.
      </p>
    </div>
  )
}

/**
 * Bring-your-own-agent: run this agent on the owner's own HTTP endpoint
 * instead of the platform's Python runtime. No third-party code executes on
 * our servers — we only POST the task and wait for a callback in the same
 * format our own runtime uses. See the Guide for the exact contract.
 */
function RuntimeCard({ agentId }: { agentId: string }) {
  const [runtimeType, setRuntimeType] = useState<'platform' | 'webhook'>('platform')
  const [webhookUrl, setWebhookUrlState] = useState('')
  const [hasSecret, setHasSecret] = useState(false)
  const [editing, setEditing] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const cfg = await getWebhookConfig(agentId)
    setRuntimeType((cfg.runtimeType as 'platform' | 'webhook') ?? 'platform')
    setWebhookUrlState(cfg.webhookUrl ?? '')
    setUrlInput(cfg.webhookUrl ?? '')
    setHasSecret(cfg.hasSecret)
  }, [agentId])

  useEffect(() => {
    load()
    setRevealedSecret(null)
    setEditing(false)
  }, [load])

  const saveUrl = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await setWebhookUrl(agentId, urlInput)
      await load()
      setEditing(false)
      setMsg('Saved.')
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const switchToPlatform = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await switchToPlatformRuntime(agentId)
      await load()
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const rotateSecret = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const { secret } = await generateAgentWebhookSecret(agentId)
      setRevealedSecret(secret)
      setHasSecret(true)
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border border-border rounded-lg p-6">
      <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
        <Webhook className="size-5" /> Runtime
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        By default this agent runs on the platform&apos;s Claude runtime. You can instead point it at
        your own HTTP endpoint (e.g. a LangChain agent you host yourself) — we send the task, your
        server sends back the result in our callback format. No code of yours ever runs on our
        servers.
      </p>

      <div className="flex items-center gap-2 mb-3 text-sm">
        <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${runtimeType === 'webhook' ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}>
          {runtimeType === 'webhook' ? 'Bring-your-own webhook' : 'Platform runtime'}
        </span>
        {runtimeType === 'webhook' && webhookUrl && (
          <code className="text-xs text-muted-foreground truncate max-w-xs">{webhookUrl}</code>
        )}
      </div>

      {runtimeType === 'webhook' && !editing ? (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setEditing(true)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
            Edit URL
          </button>
          <button onClick={switchToPlatform} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50">
            Switch back to platform runtime
          </button>
        </div>
      ) : (
        (editing || runtimeType !== 'webhook') && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://your-server.example.com/agent"
              className="h-9 w-80 rounded-md border border-border bg-background px-3 text-sm"
              disabled={busy}
            />
            <button
              onClick={saveUrl}
              disabled={busy || !urlInput.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Webhook className="size-4" />}
              Use this webhook
            </button>
            {editing && (
              <button onClick={() => setEditing(false)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
                Cancel
              </button>
            )}
          </div>
        )
      )}

      {runtimeType === 'webhook' && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm">Callback secret</span>
            <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${hasSecret ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}>
              {hasSecret ? 'configured' : 'not set — callbacks will be rejected'}
            </span>
            <button
              onClick={rotateSecret}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-secondary disabled:opacity-50"
            >
              <RefreshCw className="size-3.5" /> {hasSecret ? 'Rotate' : 'Generate'}
            </button>
          </div>
          {revealedSecret && (
            <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
              <p className="font-medium mb-1">
                Shown once — copy it now. Set it as the <code>X-Runtime-Secret</code> header your
                server sends when calling back <code>/api/runtime/callback</code>.
              </p>
              <code className="block break-all font-mono">{revealedSecret}</code>
            </div>
          )}
        </div>
      )}

      {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
    </div>
  )
}
