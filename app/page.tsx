import Image from "next/image"
import Link from "next/link"
import {
  BadgeCheck,
  Copy,
  Cpu,
  Network,
  ArrowUpRight,
  TrendingUp,
  Wallet,
  Gauge,
  ShieldCheck,
  Activity,
} from "lucide-react"
import { Panel, PanelHeader, PageHeader, RatingBadge, RiskBadge, StatCard, Progress } from "@/components/ui-kit"
import { CreditScoreChart, PerformanceChart } from "@/components/charts"
import { agent, creditScoreTrend, performanceHistory, recentTransactions } from "@/lib/data"

function fmtUsd(n: number) {
  return n.toLocaleString("en-US")
}

export default function DashboardPage() {
  const utilization = Math.round((agent.usedCredit / agent.creditLimit) * 100)

  return (
    <div>
      <PageHeader
        eyebrow="Agent Credit Dashboard"
        title="Creditworthiness overview"
        description="Real-time credit standing, performance, and settlement activity for this autonomous agent."
        action={
          <>
            <Link
              href="/profile"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 text-sm font-medium text-foreground hover:bg-secondary"
            >
              View profile <ArrowUpRight className="size-3.5" />
            </Link>
            <Link
              href="/transactions"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              New credit line
            </Link>
          </>
        }
      />

      {/* Agent identity header */}
      <Panel className="mb-6 overflow-hidden">
        <div className="flex flex-col gap-5 p-5 md:flex-row md:items-center">
          <div className="flex items-center gap-4">
            <div className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-border">
              <Image src="/agent-atlas.png" alt="Atlas-7 agent emblem" fill className="object-cover" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight text-card-foreground">{agent.name}</h2>
                {agent.verified && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                    <BadgeCheck className="size-3.5" /> Verified
                  </span>
                )}
              </div>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">{agent.handle}</p>
            </div>
          </div>

          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-4 md:grid-cols-4 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <MetaItem icon={<Wallet className="size-3.5" />} label="Wallet">
              <span className="flex items-center gap-1.5 font-mono text-xs text-card-foreground">
                {agent.wallet} <Copy className="size-3 text-muted-foreground" />
              </span>
            </MetaItem>
            <MetaItem icon={<Cpu className="size-3.5" />} label="AI Model">
              <span className="text-xs text-card-foreground">{agent.model}</span>
            </MetaItem>
            <MetaItem icon={<Network className="size-3.5" />} label="Network">
              <span className="text-xs text-card-foreground">{agent.network}</span>
            </MetaItem>
            <MetaItem icon={<Activity className="size-3.5" />} label="Status">
              <span className="flex items-center gap-1.5 text-xs font-medium text-success">
                <span className="size-1.5 rounded-full bg-success" /> Active
              </span>
            </MetaItem>
          </div>
        </div>
      </Panel>

      {/* Metric cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Panel className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Credit Rating</p>
            <Gauge className="size-4 text-muted-foreground" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold tracking-tight text-card-foreground">{agent.rating}</span>
            <RatingBadge rating={agent.rating} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">Investment grade</p>
        </Panel>

        <StatCard
          label="Credit Score"
          value={String(agent.score)}
          unit="/ 1000"
          delta="+31"
          deltaTone="up"
          hint="90d"
          accent={<TrendingUp className="size-4 text-success" />}
        />
        <StatCard
          label="Available Credit"
          value={`$${fmtUsd(agent.creditLimit - agent.usedCredit)}`}
          unit="USDC"
          hint={`of $${fmtUsd(agent.creditLimit)} limit`}
          accent={<Wallet className="size-4 text-muted-foreground" />}
        />
        <Panel className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Risk Level</p>
            <ShieldCheck className="size-4 text-muted-foreground" />
          </div>
          <div className="mt-3">
            <RiskBadge level={agent.riskLevel} />
          </div>
          <p className="mt-2.5 text-xs text-muted-foreground">Stable 6 months</p>
        </Panel>
        <StatCard
          label="Default Probability"
          value={`${agent.defaultProbability}`}
          unit="%"
          delta="-0.4%"
          deltaTone="up"
          hint="vs prior"
          accent={<Activity className="size-4 text-muted-foreground" />}
        />
      </div>

      {/* Charts */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Credit score trend"
            description="Trailing 12 months"
            action={<span className="font-mono text-sm font-semibold text-success">+131 pts YTD</span>}
          />
          <div className="p-4">
            <CreditScoreChart data={creditScoreTrend} />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Credit utilization" />
          <div className="space-y-5 p-5">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-2xl font-semibold text-card-foreground">{utilization}%</span>
                <span className="text-xs text-muted-foreground">${fmtUsd(agent.usedCredit)} drawn</span>
              </div>
              <Progress value={utilization} tone="primary" className="mt-3" />
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
              <MiniStat label="Limit" value={`$${fmtUsd(agent.creditLimit)}`} />
              <MiniStat label="Available" value={`$${fmtUsd(agent.creditLimit - agent.usedCredit)}`} />
              <MiniStat label="APR" value="6.4%" />
              <MiniStat label="Next due" value="Dec 30" />
            </div>
            <Link
              href="/credit-scores"
              className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-secondary/50 py-2 text-xs font-medium text-foreground hover:bg-secondary"
            >
              View score breakdown <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </Panel>
      </div>

      {/* Performance + transactions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Agent performance history"
            description="Task volume and success rate"
            action={
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 rounded-sm bg-chart-1/60" /> Tasks
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 rounded-full bg-chart-2" /> Success %
                </span>
              </div>
            }
          />
          <div className="p-4">
            <PerformanceChart data={performanceHistory} />
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Recent transactions"
            action={
              <Link href="/transactions" className="text-xs font-medium text-primary hover:underline">
                View all
              </Link>
            }
          />
          <ul className="divide-y divide-border">
            {recentTransactions.slice(0, 5).map((tx) => (
              <li key={tx.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-card-foreground">{tx.counterparty}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {tx.type} · {tx.time}
                  </p>
                </div>
                <span
                  className={`font-mono text-sm font-medium ${tx.amount < 0 ? "text-muted-foreground" : "text-success"}`}
                >
                  {tx.amount < 0 ? "-" : "+"}${fmtUsd(Math.abs(tx.amount))}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}

function MetaItem({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-medium text-card-foreground">{value}</p>
    </div>
  )
}
