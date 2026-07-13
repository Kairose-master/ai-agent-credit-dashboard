import Image from "next/image"
import {
  BadgeCheck,
  Wallet,
  CalendarDays,
  ShieldCheck,
  Cpu,
  CheckCircle2,
  Timer,
  Gauge,
  Star,
  FileCheck,
  ScrollText,
  AlertTriangle,
} from "lucide-react"
import { Panel, PanelHeader, PageHeader, RatingBadge, Progress } from "@/components/ui-kit"
import { agent, attestations } from "@/lib/data"

export default function ProfilePage() {
  return (
    <div>
      <PageHeader
        eyebrow="Agent Profile"
        title="Economic identity"
        description="The verifiable, on-chain identity and track record that underpins this agent's creditworthiness."
      />

      {/* Identity banner */}
      <Panel className="mb-6">
        <div className="flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative size-20 shrink-0 overflow-hidden rounded-2xl border border-border">
              <Image src="/agent-atlas.png" alt="Atlas-7 agent emblem" fill className="object-cover" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight text-card-foreground">{agent.name}</h2>
                <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                  <BadgeCheck className="size-3.5" /> Verified
                </span>
                <RatingBadge rating={agent.rating} />
              </div>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{agent.handle}</p>
              <p className="mt-2 max-w-lg text-sm text-muted-foreground text-pretty">
                Autonomous research agent specializing in market intelligence and structured web analysis. Operated by{" "}
                {agent.owner}.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 rounded-lg border border-border bg-secondary/30 p-4 text-center md:min-w-[280px]">
            <HeadStat value={agent.score} label="Score" />
            <HeadStat value="99.4%" label="Success" />
            <HeadStat value="2.5K" label="Tasks/mo" />
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Identity */}
        <Panel>
          <PanelHeader title="Identity" description="Verified credentials" />
          <div className="divide-y divide-border">
            <IdentityRow icon={<Wallet className="size-4" />} label="Wallet address">
              <span className="font-mono text-xs text-card-foreground break-all">{agent.fullWallet}</span>
            </IdentityRow>
            <IdentityRow icon={<CalendarDays className="size-4" />} label="Created">
              {agent.created}
            </IdentityRow>
            <IdentityRow icon={<ShieldCheck className="size-4" />} label="Owner verification">
              <span className="inline-flex items-center gap-1.5 text-success">
                <CheckCircle2 className="size-3.5" /> {agent.owner}
              </span>
            </IdentityRow>
            <IdentityRow icon={<Cpu className="size-4" />} label="Model version">
              {agent.model} · {agent.modelVersion}
            </IdentityRow>
          </div>
        </Panel>

        {/* Performance */}
        <Panel>
          <PanelHeader title="Performance" description="Trailing 12 months" />
          <div className="space-y-4 p-5">
            <PerfMetric icon={<CheckCircle2 className="size-4" />} label="Total tasks completed" value="24,704" />
            <PerfBar label="Success rate" value={99.4} display="99.4%" tone="success" />
            <PerfMetric icon={<Timer className="size-4" />} label="Avg response time" value="1.24s" />
            <PerfBar label="SLA compliance" value={99.1} display="99.1%" tone="success" />
            <PerfBar label="Customer satisfaction" value={96} display="4.8 / 5.0" tone="primary" />
          </div>
        </Panel>

        {/* Reputation summary */}
        <Panel>
          <PanelHeader title="Reputation" description="On-chain standing" />
          <div className="grid grid-cols-2 gap-3 p-5">
            <RepTile icon={<FileCheck className="size-4" />} value="5" label="Attestations" />
            <RepTile icon={<Star className="size-4" />} value="12" label="Achievements" />
            <RepTile icon={<ScrollText className="size-4" />} value="244" label="Contracts" />
            <RepTile icon={<AlertTriangle className="size-4" />} value="1" label="Disputes" tone="warning" />
          </div>
          <div className="border-t border-border p-5">
            <p className="text-xs text-muted-foreground text-pretty">
              1 dispute resolved in favor of this agent. No unresolved incidents in trailing 24 months.
            </p>
          </div>
        </Panel>
      </div>

      {/* Attestations table */}
      <Panel className="mt-4">
        <PanelHeader title="On-chain attestations & verified achievements" description="Issued by third parties" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Issuer</th>
                <th className="px-5 py-3 font-medium">Claim</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 text-right font-medium">Weight</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {attestations.map((a) => (
                <tr key={a.issuer} className="hover:bg-secondary/30">
                  <td className="px-5 py-3.5 font-medium text-card-foreground">{a.issuer}</td>
                  <td className="px-5 py-3.5 text-muted-foreground">{a.claim}</td>
                  <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{a.date}</td>
                  <td className="px-5 py-3.5 text-right">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                        a.weight === "High"
                          ? "border-success/30 bg-success/15 text-success"
                          : "border-border bg-secondary text-muted-foreground"
                      }`}
                    >
                      {a.weight}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function HeadStat({ value, label }: { value: string | number; label: string }) {
  return (
    <div>
      <p className="font-mono text-lg font-semibold text-card-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}

function IdentityRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-3.5">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {label}
      </span>
      <span className="text-right text-xs font-medium text-card-foreground">{children}</span>
    </div>
  )
}

function PerfMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {label}
      </span>
      <span className="font-mono text-sm font-medium text-card-foreground">{value}</span>
    </div>
  )
}

function PerfBar({ label, value, display, tone }: { label: string; value: number; display: string; tone: string }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="font-mono text-sm font-medium text-card-foreground">{display}</span>
      </div>
      <Progress value={value} tone={tone} className="mt-2" />
    </div>
  )
}

function RepTile({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode
  value: string
  label: string
  tone?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <span className={`${tone === "warning" ? "text-warning" : "text-primary"}`}>{icon}</span>
      <p className="mt-2 font-mono text-lg font-semibold text-card-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}
