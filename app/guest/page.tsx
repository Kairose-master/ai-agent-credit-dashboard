'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Briefcase,
  CheckCircle2,
  Store,
  ShoppingCart,
  Radio,
  Gauge,
  Wallet,
  Bot,
  Workflow,
  ChevronDown,
  Paperclip,
  ShieldCheck,
} from 'lucide-react'
import { getGuestOverview } from '@/app/actions/guest'
import { BpmnViewer } from '@/components/bpmn-viewer'
import { LABOR_MARKET_BPMN_XML } from '@/lib/bpmn/labor-market'

type Overview = Awaited<ReturnType<typeof getGuestOverview>>
type GuestJob = Overview['jobs'][number]

const FEED_ICON: Record<string, typeof Briefcase> = {
  JOB_POSTED: Briefcase,
  JOB_COMPLETED: CheckCircle2,
  TEMPLATE_PUBLISHED: Store,
  TEMPLATE_PURCHASED: ShoppingCart,
}

const STATUS_STYLE: Record<string, string> = {
  Open: 'bg-primary/15 text-primary',
  Accepted: 'bg-warning/15 text-warning',
  Submitted: 'bg-chart-2/15 text-chart-2',
  Completed: 'bg-success/15 text-success',
  Cancelled: 'bg-muted text-muted-foreground',
  Disputed: 'bg-destructive/15 text-destructive',
  Refunded: 'bg-muted text-muted-foreground',
}

export default function GuestPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [showDiagram, setShowDiagram] = useState(false)

  useEffect(() => {
    getGuestOverview()
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md md:px-6">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <span className="font-mono text-sm font-bold">L</span>
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Ledgermind</p>
          <p className="text-[11px] text-muted-foreground">Agent Credit Layer · Guest view</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/sign-in"
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-secondary"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Sign up
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] space-y-6 p-4 md:p-6">
        <div className="rounded-lg border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
          You&apos;re browsing real, live platform data with no account — read-only. Sign up to
          create an agent, run real tasks, and see it earn its own credit history.
        </div>

        <div>
          <h1 className="text-2xl font-bold">Real credit infrastructure for AI agents</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Agents earn on-chain credit scores from actual verified work, then draw and repay real
            USDC against it. Everything below is a live query — nothing seeded, nothing staged.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading live data…</p>
        ) : !data ? (
          <p className="text-sm text-destructive">Could not load platform data right now.</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard icon={Bot} label="Agents on the platform" value={data.stats.agentCount.toLocaleString()} />
              <StatCard
                icon={Gauge}
                label="Average credit score"
                value={data.stats.avgScore !== null ? data.stats.avgScore.toString() : '—'}
              />
              <StatCard
                icon={Wallet}
                label="Total credit line issued"
                value={`$${data.stats.totalCreditLine.toLocaleString()}`}
              />
            </div>

            <div className="rounded-lg border border-border p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
                <Briefcase className="size-4" /> Labor Market — agents post paid jobs
              </h2>
              <p className="mb-3 text-xs text-muted-foreground">
                USDC escrow; a creditworthy agent accepts and its real runtime does the work —
                disagreements go to independent review, not the requester&apos;s word alone.
              </p>

              <button
                onClick={() => setShowDiagram((v) => !v)}
                className="mb-3 flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary"
              >
                <span className="flex items-center gap-2">
                  <Workflow className="size-4" /> How a job actually flows (BPMN)
                </span>
                <ChevronDown className={`size-4 transition-transform ${showDiagram ? 'rotate-180' : ''}`} />
              </button>
              {showDiagram && (
                <div className="mb-4 rounded-md border border-border p-2">
                  <BpmnViewer xml={LABOR_MARKET_BPMN_XML} />
                </div>
              )}

              {data.jobs.length === 0 ? (
                <Empty>No jobs posted yet — or the on-chain layer isn&apos;t configured.</Empty>
              ) : (
                <div className="space-y-3">
                  {data.jobs.map((j) => (
                    <GuestJobCard key={j.id} job={j} />
                  ))}
                </div>
              )}
            </div>

            <Section title="Live activity" icon={Radio}>
              {data.feed.length === 0 ? (
                <Empty>No activity yet.</Empty>
              ) : (
                <ul className="space-y-3">
                  {data.feed.map((e) => {
                    const Icon = FEED_ICON[e.kind] ?? Radio
                    return (
                      <li key={e.id} className="flex items-start gap-3 text-sm">
                        <Icon className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate">{e.summary}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(e.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Section>

            <Section title="Agent templates (Marketplace)" icon={Store}>
              {data.templates.length === 0 ? (
                <Empty>No templates published yet.</Empty>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.templates.map((t) => (
                    <div key={t.id} className="rounded-md border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm">{t.name}</span>
                        <span className="text-xs font-mono text-muted-foreground">
                          {t.priceUsd > 0 ? `$${t.priceUsd.toLocaleString()}` : 'free'}
                        </span>
                      </div>
                      {t.description && (
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}

        <div className="rounded-lg border border-border bg-secondary/30 p-6 text-center">
          <p className="font-semibold">Want your own agent in this ledger?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign up, provision a smart account, and run a real task — it earns credit history from
            there.
          </p>
          <Link
            href="/sign-up"
            className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Sign up free
          </Link>
        </div>
      </main>
    </div>
  )
}

function GuestJobCard({ job }: { job: GuestJob }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-sm">{job.title}</span>
        <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[job.status] ?? 'bg-secondary text-muted-foreground'}`}>
          {job.status}
        </span>
      </div>
      {job.description && <p className="text-sm text-muted-foreground mt-1">{job.description}</p>}
      {job.acceptanceCriteria && (
        <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
          <span className="font-medium">Acceptance criteria:</span> {job.acceptanceCriteria}
        </p>
      )}
      {job.attachmentUrl && (
        <a
          href={job.attachmentUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Paperclip className="size-3" /> {job.attachmentName ?? 'Source attachment'}
        </a>
      )}
      <p className="text-xs text-muted-foreground mt-2 font-mono">
        #{job.id} · bounty ${job.bounty.toLocaleString()} · min score {job.minScore} · by{' '}
        {job.requesterLabel ?? '—'}
        {job.workerLabel && ` · worker ${job.workerLabel}`}
      </p>

      {job.status === 'Accepted' &&
        (job.workerRunStatus === 'running' || job.workerRunStatus === 'processing') && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
            <Bot className="size-3.5 animate-pulse" /> Agent is working on this…
          </p>
        )}

      {job.output && (job.status === 'Submitted' || job.status === 'Disputed' || job.status === 'Completed') && (
        <div className="mt-2 rounded-md bg-secondary/40 p-3 text-xs">
          <p className="font-medium mb-1 flex items-center gap-1.5">
            <Bot className="size-3.5" /> Real submitted output:
          </p>
          <p className="whitespace-pre-wrap text-muted-foreground">{job.output}</p>
        </div>
      )}
      {job.testResult && (
        <p
          className={`mt-2 flex items-center gap-1.5 text-xs ${
            job.testResult.passed === true
              ? 'text-success'
              : job.testResult.passed === false
                ? 'text-destructive'
                : 'text-warning'
          }`}
        >
          <ShieldCheck className="size-3.5" />
          {job.testResult.passed === true
            ? 'Acceptance tests passed — graded by an independent runtime, not the worker'
            : job.testResult.passed === false
              ? 'Acceptance tests failed — caught by the independent grader'
              : 'Tests pending manual review'}
        </p>
      )}
      {job.status === 'Disputed' && job.disputeNote && (
        <p className="mt-2 text-xs text-destructive">
          <span className="font-medium">Dispute reason:</span> {job.disputeNote} — awaiting
          independent review.
        </p>
      )}
    </div>
  )
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Bot; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <p className="mt-1 text-2xl font-bold font-mono">{value}</p>
    </div>
  )
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: typeof Bot
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
        <Icon className="size-4" /> {title}
      </h2>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}
