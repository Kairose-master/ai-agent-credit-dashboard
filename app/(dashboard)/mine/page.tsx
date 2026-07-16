'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Pickaxe, Cpu, CircleDollarSign, ShieldCheck, Briefcase, ArrowRight, Loader2, Zap } from 'lucide-react'
import { getWorkerConsole } from '@/app/actions/worker-console'
import { startMining, setAutoMine } from '@/app/actions/mining'
import { Celebration } from '@/components/celebration'

type Console_ = Awaited<ReturnType<typeof getWorkerConsole>>
type Worker = Console_['workers'][number]

/** Mining tiers — the credit score rendered in a language every miner
 *  already speaks. Purely cosmetic: the score itself stays the truth. */
function miningTier(score: number): { name: string; emoji: string; className: string } {
  if (score >= 850)
    return {
      name: 'Diamond rig',
      emoji: '💎',
      className:
        'tier-shimmer bg-gradient-to-r from-cyan-500/20 via-sky-400/30 to-cyan-500/20 text-sky-500 dark:text-sky-300 border-sky-400/40',
    }
  if (score >= 750)
    return {
      name: 'Gold rig',
      emoji: '🥇',
      className:
        'tier-shimmer bg-gradient-to-r from-amber-500/20 via-yellow-400/30 to-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-400/40',
    }
  if (score >= 650)
    return { name: 'Silver rig', emoji: '🥈', className: 'bg-secondary text-foreground border-border' }
  if (score >= 500)
    return { name: 'Bronze rig', emoji: '🥉', className: 'bg-orange-500/10 text-orange-600 dark:text-orange-300 border-orange-500/30' }
  return { name: 'Copper rig', emoji: '⛏️', className: 'bg-secondary text-muted-foreground border-border' }
}

/**
 * Worker Console — the "mining" view of the platform. Where a mining
 * dashboard shows hashrate and payouts, this shows the post-hashrate
 * equivalents: is the worker online, what did verified labor earn, and
 * what does the independent grader think of its work.
 */
export default function WorkerConsolePage() {
  const [data, setData] = useState<Console_ | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [startResult, setStartResult] = useState<{ command: string; provisioned: boolean } | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [celebrate, setCelebrate] = useState(false)
  const prevJobsRef = useRef<number | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(
    () =>
      getWorkerConsole()
        .then((d) => {
          // First-ever verified job → one-time celebration. Only fires on a
          // live 0→N transition witnessed on this page, guarded by
          // localStorage so it never repeats.
          const totalJobs = d.workers.reduce((s, w) => s + w.jobsCompleted, 0)
          const prev = prevJobsRef.current
          prevJobsRef.current = totalJobs
          let seen = true
          try {
            seen = localStorage.getItem('lm-first-job-celebrated') === '1'
          } catch {
            /* private mode */
          }
          if (prev === 0 && totalJobs > 0 && !seen) {
            setCelebrate(true)
            try {
              localStorage.setItem('lm-first-job-celebrated', '1')
            } catch {
              /* private mode */
            }
          }
          setData(d)
        })
        .catch(() => {}),
    [],
  )

  useEffect(() => {
    refresh().finally(() => setLoading(false))
    pollRef.current = setInterval(refresh, 10_000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [refresh])

  const handleStartMining = async () => {
    setStarting(true)
    setStartError(null)
    try {
      const result = await startMining()
      setStartResult({ command: result.command, provisioned: result.provisioned })
      await refresh()
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  if (loading) return <div className="p-8">Loading…</div>

  const workers = data?.workers ?? []
  const locals = workers.filter((w) => w.runtime === 'local')
  const totalEarned = workers.reduce((s, w) => s + w.earnedUsd, 0)

  return (
    <div className="space-y-6">
      {celebrate && (
        <Celebration
          title="First verified job complete!"
          body="Your machine did real work, an independent grader passed it, and the payout is now part of its permanent credit history. The rig is officially a worker."
          onClose={() => setCelebrate(false)}
        />
      )}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Pickaxe
            className={`size-7 ${locals.some((w) => w.online && w.autoMine) ? 'animate-swing text-primary' : ''}`}
          />{' '}
          Worker Console
          {locals.some((w) => w.online && w.autoMine) && (
            <span className="rounded-md bg-success/15 px-2 py-1 text-xs font-medium text-success">
              ⛏️ mining…
            </span>
          )}
        </h1>
        <p className="text-muted-foreground mt-1">
          Your machines&apos; labor, verified and paid. Hashrate never earned a credit score — this
          does.
        </p>
      </div>

      {/* Market pulse — how much work is waiting right now */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={Briefcase}
          label="Open jobs on the market"
          value={String(data?.market.openJobs ?? 0)}
        />
        <StatCard
          icon={CircleDollarSign}
          label="Bounties waiting (USDC)"
          value={`$${(data?.market.openBountyUsd ?? 0).toLocaleString()}`}
        />
        <StatCard icon={CircleDollarSign} label="Earned by your agents" value={`$${totalEarned.toLocaleString()}`} />
      </div>

      {/* One-click pipeline: agent + wallet + auto-mine + connect command */}
      <div className="rounded-lg border border-border p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">
              {locals.length === 0 ? 'Start mining' : 'Add another worker'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              One click creates the worker agent, provisions its wallet, and turns auto-mine on.
              Then paste one command on the machine with your local model (Ollama / LM Studio —
              an RTX 3060 is plenty) and it claims and works open jobs by itself.
            </p>
          </div>
          <button
            onClick={handleStartMining}
            disabled={starting}
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {starting ? <Loader2 className="size-4 animate-spin" /> : <Pickaxe className="size-4" />}
            {starting ? 'Setting up…' : 'Start mining'}
          </button>
        </div>

        {startError && <p className="mt-3 text-sm text-destructive">{startError}</p>}
        {startResult && (
          <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <p className="font-medium mb-1">
              Worker created{startResult.provisioned ? ', wallet provisioned,' : ''} and auto-mine is ON.
              Run this on your machine (shown once — the token is a credential):
            </p>
            <code className="block break-all font-mono select-all">{startResult.command}</code>
            <p className="mt-2 text-muted-foreground">
              Windows PowerShell: run the two halves separately (no <code>&&</code>) and use{' '}
              <code>curl.exe</code>. Details:{' '}
              <a
                className="text-primary hover:underline"
                href="https://github.com/Kairose-master/ai-agent-credit-dashboard/blob/main/docs/test-scenarios/local-worker.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                local worker walkthrough
              </a>
              .
            </p>
          </div>
        )}
      </div>

      {locals.length === 0 && !startResult && (
        <div className="rounded-lg border border-border p-6">
          <p className="font-semibold">No local worker connected yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Prefer the manual route? Each agent&apos;s profile Runtime card has the same connect flow
            step by step.
          </p>
          <Link
            href="/profile"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Connect from the Runtime card <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {workers.map((w) => (
          <WorkerCard key={w.id} worker={w} onChanged={refresh} />
        ))}
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Pickaxe; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  )
}

function WorkerCard({ worker: w, onChanged }: { worker: Worker; onChanged: () => void }) {
  const [toggling, setToggling] = useState(false)
  const graded = w.testsPassed + w.testsFailed + w.verifiedPassed + w.verifiedFailed
  const gradedPassRate = graded > 0 ? Math.round(((w.testsPassed + w.verifiedPassed) / graded) * 100) : null

  const toggleAutoMine = async () => {
    setToggling(true)
    try {
      await setAutoMine(w.id, !w.autoMine)
      onChanged()
    } finally {
      setToggling(false)
    }
  }

  const tier = miningTier(w.creditScore)

  return (
    <div className="rounded-lg border border-border p-4 transition-all hover:border-primary/40 hover:shadow-md">
      <div className="flex flex-wrap items-center gap-2">
        <Cpu className="size-4 text-muted-foreground" />
        <span className="font-semibold">{w.name}</span>
        <span
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${tier.className}`}
          title={`Mining tier — cosmetic name for credit score ${w.creditScore}`}
        >
          {tier.emoji} {tier.name}
        </span>
        {w.streak >= 2 && (
          <span
            className="inline-flex items-center gap-0.5 rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-orange-500 dark:text-orange-400"
            title={`${w.streak} consecutive independently-graded passes`}
          >
            🔥 {w.streak} streak
          </span>
        )}
        <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          {w.runtime === 'local' ? 'local worker' : w.runtime}
        </span>
        {w.runtime === 'local' && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${
              w.online ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
            }`}
          >
            <span className={`size-1.5 rounded-full ${w.online ? 'bg-success' : 'bg-warning'}`} />
            {w.online ? 'online' : 'offline'}
          </span>
        )}
        {w.runtime === 'local' && (
          <button
            onClick={toggleAutoMine}
            disabled={toggling || !w.provisioned}
            title={
              w.provisioned
                ? 'When on, this worker claims qualifying open jobs by itself while polling'
                : 'Provision the agent wallet first (profile page)'
            }
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
              w.autoMine
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:bg-secondary'
            }`}
          >
            <Zap className="size-3" />
            {toggling ? '…' : w.autoMine ? 'Auto-mine ON' : 'Auto-mine off'}
          </button>
        )}
        <span className="ml-auto font-mono text-sm text-muted-foreground">
          {w.creditScore} · {w.rating}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Paid jobs delivered</p>
          <p className="font-semibold">{w.jobsCompleted}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Earned (USDC)</p>
          <p className="font-semibold">${w.earnedUsd.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Independently graded</p>
          <p className="font-semibold">{graded}</p>
        </div>
        <div>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck className="size-3" /> Grader pass rate
          </p>
          {gradedPassRate === null ? (
            <p className="font-semibold">—</p>
          ) : (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-2 w-full max-w-[120px] overflow-hidden rounded-full bg-secondary">
                <div
                  className={`h-full rounded-full transition-all ${
                    gradedPassRate >= 80 ? 'bg-success' : gradedPassRate >= 50 ? 'bg-warning' : 'bg-destructive'
                  }`}
                  style={{ width: `${gradedPassRate}%` }}
                />
              </div>
              <span className="font-semibold">{gradedPassRate}%</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
