import Link from "next/link"
import { Info, CheckCircle2, AlertTriangle, ArrowUpRight, ShieldCheck } from "lucide-react"
import { Panel, PanelHeader, PageHeader, RatingBadge, RiskBadge, Progress } from "@/components/ui-kit"
import { agent, scoreFactors, riskFactors } from "@/lib/data"

const factorColors: Record<string, string> = {
  "chart-1": "bg-chart-1",
  "chart-2": "bg-chart-2",
  "chart-3": "bg-chart-3",
  "chart-4": "bg-chart-4",
}

export default function CreditAssessmentPage() {
  const weighted = scoreFactors.reduce((acc, f) => acc + (f.score * f.weight) / 100, 0)

  return (
    <div>
      <PageHeader
        eyebrow="Credit Assessment"
        title="How this score is calculated"
        description="A transparent, weighted breakdown of the factors driving this agent's 872 credit score."
        action={
          <div className="flex items-center gap-2">
            <RatingBadge rating={agent.rating} />
            <span className="inline-flex h-9 items-center rounded-md border border-border bg-secondary/50 px-3 font-mono text-sm font-semibold text-card-foreground">
              {agent.score} / 1000
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Composite */}
        <Panel className="lg:col-span-1">
          <PanelHeader title="Composite score" />
          <div className="flex flex-col items-center p-6">
            <ScoreDial score={agent.score} />
            <div className="mt-5 w-full space-y-2.5">
              {scoreFactors.map((f) => (
                <div key={f.key} className="flex items-center gap-3 text-sm">
                  <span className={`size-2.5 rounded-sm ${factorColors[f.color]}`} />
                  <span className="flex-1 text-muted-foreground">{f.key}</span>
                  <span className="font-mono text-xs text-muted-foreground">{f.weight}%</span>
                  <span className="font-mono text-sm font-medium text-card-foreground">{f.score}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 w-full rounded-lg border border-border bg-secondary/30 p-4 text-center">
              <p className="text-xs text-muted-foreground">Weighted composite</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-card-foreground">
                {(weighted * 10).toFixed(0)}
                <span className="text-sm text-muted-foreground"> / 1000</span>
              </p>
            </div>
          </div>
        </Panel>

        {/* Factor breakdown */}
        <div className="space-y-4 lg:col-span-2">
          {scoreFactors.map((f) => (
            <Panel key={f.key} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className={`flex size-10 items-center justify-center rounded-lg ${factorColors[f.color]}/15`}>
                    <span className={`font-mono text-sm font-bold ${factorColors[f.color].replace("bg-", "text-")}`}>
                      {f.weight}%
                    </span>
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-card-foreground">{f.key}</h3>
                    <p className="text-xs text-muted-foreground">Weight: {f.weight}% of composite</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono text-lg font-semibold text-card-foreground">{f.score}</p>
                  <p className="text-[11px] text-muted-foreground">component score</p>
                </div>
              </div>
              <div className="mt-4 space-y-3 border-t border-border pt-4">
                {f.items.map((item) => (
                  <div key={item.label}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{item.label}</span>
                      <span className="font-mono text-sm font-medium text-card-foreground">{item.value}</span>
                    </div>
                    <Progress value={item.contribution} tone={f.color === "chart-4" ? "warning" : "success"} className="mt-2" />
                  </div>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      </div>

      {/* Risk factors + recommendation */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader title="Risk factors" description="Signals monitored by the underwriting model" />
          <div className="grid grid-cols-1 gap-px overflow-hidden bg-border sm:grid-cols-2">
            {riskFactors.map((r) => (
              <div key={r.label} className="bg-card p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-card-foreground">{r.label}</span>
                  <RiskBadge level={r.level} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground text-pretty">{r.note}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="flex flex-col">
          <PanelHeader title="Recommendation" />
          <div className="flex flex-1 flex-col p-5">
            <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3">
              <ShieldCheck className="size-5 text-success" />
              <div>
                <p className="text-sm font-semibold text-success">Approve — extend credit</p>
                <p className="text-[11px] text-muted-foreground">Investment grade counterparty</p>
              </div>
            </div>
            <ul className="mt-4 space-y-3 text-sm">
              <RecItem good>Eligible for up to $25,000 USDC revolving credit</RecItem>
              <RecItem good>Recommended APR: 6.4% at 20% collateral</RecItem>
              <RecItem good>Low default probability (1.8%) vs 2.3% portfolio avg</RecItem>
              <RecItem>Monitor dispute history at next quarterly review</RecItem>
            </ul>
            <div className="mt-auto pt-5">
              <Link
                href="/transactions"
                className="flex items-center justify-center gap-1.5 rounded-md bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Open credit line <ArrowUpRight className="size-4" />
              </Link>
            </div>
          </div>
        </Panel>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-secondary/30 p-4">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground text-pretty">
          Scores are computed from verifiable on-chain activity, third-party attestations, and behavioral telemetry.
          Model version <span className="font-mono">underwriter-v3.2</span>. Recalculated every 6 hours.
        </p>
      </div>
    </div>
  )
}

function ScoreDial({ score }: { score: number }) {
  const pct = (score / 1000) * 100
  const circumference = 2 * Math.PI * 52
  const offset = circumference - (pct / 100) * circumference
  return (
    <div className="relative flex size-40 items-center justify-center">
      <svg className="size-40 -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--color-secondary)" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute text-center">
        <p className="font-mono text-3xl font-semibold text-card-foreground">{score}</p>
        <p className="text-[11px] text-muted-foreground">out of 1000</p>
      </div>
    </div>
  )
}

function RecItem({ children, good }: { children: React.ReactNode; good?: boolean }) {
  return (
    <li className="flex items-start gap-2.5">
      {good ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
      ) : (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      )}
      <span className="text-muted-foreground text-pretty">{children}</span>
    </li>
  )
}
