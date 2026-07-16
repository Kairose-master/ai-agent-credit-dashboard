'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Pickaxe, Cpu, CircleDollarSign, ShieldCheck, Briefcase, ArrowRight } from 'lucide-react'
import { getWorkerConsole } from '@/app/actions/worker-console'

type Console_ = Awaited<ReturnType<typeof getWorkerConsole>>
type Worker = Console_['workers'][number]

/**
 * Worker Console — the "mining" view of the platform. Where a mining
 * dashboard shows hashrate and payouts, this shows the post-hashrate
 * equivalents: is the worker online, what did verified labor earn, and
 * what does the independent grader think of its work.
 */
export default function WorkerConsolePage() {
  const [data, setData] = useState<Console_ | null>(null)
  const [loading, setLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(() => getWorkerConsole().then(setData).catch(() => {}), [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
    pollRef.current = setInterval(refresh, 10_000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [refresh])

  if (loading) return <div className="p-8">Loading…</div>

  const workers = data?.workers ?? []
  const locals = workers.filter((w) => w.runtime === 'local')
  const totalEarned = workers.reduce((s, w) => s + w.earnedUsd, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Pickaxe className="size-7" /> Worker Console
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

      {locals.length === 0 && (
        <div className="rounded-lg border border-border p-6">
          <p className="font-semibold">No local worker connected yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            One command connects a locally-hosted model (Ollama, LM Studio — an RTX 3060 is plenty)
            as a market worker: no tunnel, no port forwarding, your machine polls outbound.
          </p>
          <Link
            href="/profile"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Connect one from your agent&apos;s Runtime card <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {workers.map((w) => (
          <WorkerCard key={w.id} worker={w} />
        ))}
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Pickaxe; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  )
}

function WorkerCard({ worker: w }: { worker: Worker }) {
  const graded = w.testsPassed + w.testsFailed + w.verifiedPassed + w.verifiedFailed
  const gradedPassRate = graded > 0 ? Math.round(((w.testsPassed + w.verifiedPassed) / graded) * 100) : null

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Cpu className="size-4 text-muted-foreground" />
        <span className="font-semibold">{w.name}</span>
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
          <p className="font-semibold">{gradedPassRate === null ? '—' : `${gradedPassRate}%`}</p>
        </div>
      </div>
    </div>
  )
}
