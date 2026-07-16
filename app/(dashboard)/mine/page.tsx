'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Pickaxe, Cpu, CircleDollarSign, ShieldCheck, Briefcase, ArrowRight, Loader2, Zap, Wallet } from 'lucide-react'
import { getWorkerConsole } from '@/app/actions/worker-console'
import { startMining, setAutoMine } from '@/app/actions/mining'
import { getPayoutAddress, setPayoutAddress, withdrawAllEarnings } from '@/app/actions/treasury'
import { Celebration } from '@/components/celebration'
import { useI18n } from '@/lib/i18n'

type Console_ = Awaited<ReturnType<typeof getWorkerConsole>>
type Worker = Console_['workers'][number]

/** Mining tiers — the credit score rendered in a language every miner
 *  already speaks. Purely cosmetic: the score itself stays the truth. */
function miningTier(score: number): { nameKey: string; emoji: string; className: string } {
  if (score >= 850)
    return {
      nameKey: 'mine.tier.diamond',
      emoji: '💎',
      className:
        'tier-shimmer bg-gradient-to-r from-cyan-500/20 via-sky-400/30 to-cyan-500/20 text-sky-500 dark:text-sky-300 border-sky-400/40',
    }
  if (score >= 750)
    return {
      nameKey: 'mine.tier.gold',
      emoji: '🥇',
      className:
        'tier-shimmer bg-gradient-to-r from-amber-500/20 via-yellow-400/30 to-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-400/40',
    }
  if (score >= 650)
    return { nameKey: 'mine.tier.silver', emoji: '🥈', className: 'bg-secondary text-foreground border-border' }
  if (score >= 500)
    return { nameKey: 'mine.tier.bronze', emoji: '🥉', className: 'bg-orange-500/10 text-orange-600 dark:text-orange-300 border-orange-500/30' }
  return { nameKey: 'mine.tier.copper', emoji: '⛏️', className: 'bg-secondary text-muted-foreground border-border' }
}

/**
 * Worker Console — the "mining" view of the platform. Where a mining
 * dashboard shows hashrate and payouts, this shows the post-hashrate
 * equivalents: is the worker online, what did verified labor earn, and
 * what does the independent grader think of its work.
 */
export default function WorkerConsolePage() {
  const { t } = useI18n()
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

  if (loading) return <div className="p-8">{t('mine.loading')}</div>

  const workers = data?.workers ?? []
  const locals = workers.filter((w) => w.runtime === 'local')
  const totalEarned = workers.reduce((s, w) => s + w.earnedUsd, 0)

  return (
    <div className="space-y-6">
      {celebrate && (
        <Celebration
          title={t('mine.celebration.title')}
          body={t('mine.celebration.body')}
          onClose={() => setCelebrate(false)}
        />
      )}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Pickaxe
            className={`size-7 ${locals.some((w) => w.online && w.autoMine) ? 'animate-swing text-primary' : ''}`}
          />{' '}
          {t('mine.title')}
          {locals.some((w) => w.online && w.autoMine) && (
            <span className="rounded-md bg-success/15 px-2 py-1 text-xs font-medium text-success">
              ⛏️ {t('mine.miningBadge')}
            </span>
          )}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t('mine.subtitle')}
        </p>
      </div>

      {/* Market pulse — how much work is waiting right now */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={Briefcase}
          label={t('mine.stats.openJobs')}
          value={String(data?.market.openJobs ?? 0)}
        />
        <StatCard
          icon={CircleDollarSign}
          label={t('mine.stats.bountiesWaiting')}
          value={`$${(data?.market.openBountyUsd ?? 0).toLocaleString()}`}
        />
        <StatCard icon={CircleDollarSign} label={t('mine.stats.earnedByAgents')} value={`$${totalEarned.toLocaleString()}`} />
      </div>

      <PayoutCard hasProvisionedWorker={workers.some((w) => w.provisioned)} />

      {/* One-click pipeline: agent + wallet + auto-mine + connect command */}
      <div className="rounded-lg border border-border p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">
              {locals.length === 0 ? t('mine.start.title') : t('mine.start.addAnother')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('mine.start.description')}
            </p>
          </div>
          <button
            onClick={handleStartMining}
            disabled={starting}
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {starting ? <Loader2 className="size-4 animate-spin" /> : <Pickaxe className="size-4" />}
            {starting ? t('mine.start.settingUp') : t('mine.start.button')}
          </button>
        </div>

        {startError && <p className="mt-3 text-sm text-destructive">{startError}</p>}
        {startResult && (
          <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <p className="font-medium mb-1">
              {startResult.provisioned ? t('mine.start.createdProvisioned') : t('mine.start.created')}
            </p>
            <code className="block break-all font-mono select-all">{startResult.command}</code>
            <p className="mt-2 text-muted-foreground">
              {t('mine.start.psNoteBefore')} <code>&&</code>{t('mine.start.psNoteMiddle')}{' '}
              <code>curl.exe</code>{t('mine.start.psNoteAfter')}{' '}
              <a
                className="text-primary hover:underline"
                href="https://github.com/Kairose-master/ai-agent-credit-dashboard/blob/main/docs/test-scenarios/local-worker.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('mine.start.walkthroughLink')}
              </a>
              .
            </p>
          </div>
        )}
      </div>

      {locals.length === 0 && !startResult && (
        <div className="rounded-lg border border-border p-6">
          <p className="font-semibold">{t('mine.empty.title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('mine.empty.description')}
          </p>
          <Link
            href="/profile"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            {t('mine.empty.connectLink')} <ArrowRight className="size-3.5" />
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

/**
 * Pre-register a payout wallet once, then settle every worker with one
 * click — sweeps each provisioned agent's USDC balance to that address
 * instead of typing a recipient into the Treasury card per agent, per
 * withdrawal.
 */
function PayoutCard({ hasProvisionedWorker }: { hasProvisionedWorker: boolean }) {
  const { t } = useI18n()
  const [address, setAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getPayoutAddress()
      .then((r) => setAddress(r.payoutAddress ?? ''))
      .catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await setPayoutAddress(address)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const withdraw = async () => {
    setWithdrawing(true)
    setError(null)
    setResult(null)
    try {
      const r = await withdrawAllEarnings()
      if (r.totalSent <= 0) {
        setResult(t('mine.payout.noEarnings'))
      } else {
        setResult(t('mine.payout.resultSummary', { total: r.totalSent.toFixed(2), address: `${r.to.slice(0, 6)}…${r.to.slice(-4)}` }))
      }
      const failed = r.results.filter((x): x is typeof x & { error: string } => Boolean(x.error))
      if (failed.length > 0) {
        setError(failed.map((x) => t('mine.payout.perAgentError', { name: x.name, error: x.error })).join(' · '))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWithdrawing(false)
    }
  }

  return (
    <div className="rounded-lg border border-border p-6">
      <p className="flex items-center gap-2 font-semibold">
        <Wallet className="size-4" /> {t('mine.payout.title')}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{t('mine.payout.description')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={t('mine.payout.placeholder')}
          className="min-w-[280px] flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
        />
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {saving ? t('mine.payout.saving') : t('mine.payout.save')}
        </button>
        <button
          onClick={withdraw}
          disabled={withdrawing || !address || !hasProvisionedWorker}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {withdrawing ? <Loader2 className="size-3.5 animate-spin" /> : <CircleDollarSign className="size-3.5" />}
          {withdrawing ? t('mine.payout.withdrawing') : t('mine.payout.withdraw')}
        </button>
      </div>
      {saved && !error && <p className="mt-2 text-sm text-success">{t('mine.payout.saved')}</p>}
      {result && <p className="mt-2 text-sm text-success">{result}</p>}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}

function WorkerCard({ worker: w, onChanged }: { worker: Worker; onChanged: () => void }) {
  const { t } = useI18n()
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
          title={t('mine.tier.tooltip', { score: w.creditScore })}
        >
          {tier.emoji} {t(tier.nameKey)}
        </span>
        {w.streak >= 2 && (
          <span
            className="inline-flex items-center gap-0.5 rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-orange-500 dark:text-orange-400"
            title={t('mine.streak.tooltip', { streak: w.streak })}
          >
            🔥 {t('mine.streak.badge', { streak: w.streak })}
          </span>
        )}
        <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          {w.runtime === 'local' ? t('mine.localWorker') : w.runtime}
        </span>
        {w.runtime === 'local' && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${
              w.online ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
            }`}
          >
            <span className={`size-1.5 rounded-full ${w.online ? 'bg-success' : 'bg-warning'}`} />
            {w.online ? t('mine.online') : t('mine.offline')}
          </span>
        )}
        {w.runtime === 'local' && (
          <button
            onClick={toggleAutoMine}
            disabled={toggling || !w.provisioned}
            title={
              w.provisioned
                ? t('mine.autoMine.tooltip')
                : t('mine.autoMine.provisionFirst')
            }
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
              w.autoMine
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:bg-secondary'
            }`}
          >
            <Zap className="size-3" />
            {toggling ? '…' : w.autoMine ? t('mine.autoMine.on') : t('mine.autoMine.off')}
          </button>
        )}
        <span className="ml-auto font-mono text-sm text-muted-foreground">
          {w.creditScore} · {w.rating}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">{t('mine.worker.paidJobs')}</p>
          <p className="font-semibold">{w.jobsCompleted}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('mine.worker.earned')}</p>
          <p className="font-semibold">${w.earnedUsd.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('mine.worker.graded')}</p>
          <p className="font-semibold">{graded}</p>
        </div>
        <div>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck className="size-3" /> {t('mine.worker.passRate')}
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
