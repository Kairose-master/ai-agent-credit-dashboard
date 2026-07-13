import { ShieldAlert, TrendingDown, Layers, Umbrella, AlertOctagon } from "lucide-react"
import { Panel, PanelHeader, PageHeader, StatCard, Progress } from "@/components/ui-kit"
import { DefaultProbabilityChart, RiskDistributionChart, ExposureChart } from "@/components/charts"
import { defaultProbabilitySeries, riskDistribution, portfolioExposure, incidents } from "@/lib/data"

export default function RiskPage() {
  const totalAgents = riskDistribution.reduce((a, b) => a + b.count, 0)

  return (
    <div>
      <PageHeader
        eyebrow="Risk Analytics"
        title="Portfolio risk overview"
        description="Institutional view across 1,421 active agents and $14.2M in outstanding credit exposure."
        action={
          <span className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
            <ShieldAlert className="size-3.5" /> Portfolio healthy
          </span>
        }
      />

      {/* Top stats */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Weighted default rate"
          value="2.3"
          unit="%"
          delta="-0.2%"
          deltaTone="up"
          hint="30d"
          accent={<TrendingDown className="size-4 text-success" />}
        />
        <StatCard
          label="Total exposure"
          value="$14.2M"
          hint="USDC outstanding"
          accent={<Layers className="size-4 text-muted-foreground" />}
        />
        <StatCard
          label="Insurance coverage"
          value="$11.8M"
          hint="83% of exposure"
          accent={<Umbrella className="size-4 text-muted-foreground" />}
        />
        <StatCard
          label="Incidents (90d)"
          value="4"
          delta="All resolved"
          deltaTone="neutral"
          accent={<AlertOctagon className="size-4 text-muted-foreground" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Default probability"
            description="This agent vs portfolio average"
            action={
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 rounded-full bg-primary" /> Agent
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 rounded-full bg-muted-foreground" /> Portfolio
                </span>
              </div>
            }
          />
          <div className="p-4">
            <DefaultProbabilityChart data={defaultProbabilitySeries} />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Risk distribution" description={`${totalAgents} agents by rating band`} />
          <div className="p-4">
            <RiskDistributionChart data={riskDistribution} />
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader title="Portfolio exposure" description="Outstanding credit by sector ($M)" />
          <div className="p-4">
            <ExposureChart data={portfolioExposure} />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Insurance coverage" />
          <div className="space-y-5 p-5">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-2xl font-semibold text-card-foreground">83%</span>
                <span className="text-xs text-muted-foreground">$11.8M / $14.2M</span>
              </div>
              <Progress value={83} tone="success" className="mt-3" />
            </div>
            <div className="space-y-3 border-t border-border pt-4 text-sm">
              <CoverageRow label="Default protection pool" value="$8.4M" />
              <CoverageRow label="Third-party underwriters" value="$2.1M" />
              <CoverageRow label="Collateral reserves" value="$1.3M" />
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3 text-xs text-muted-foreground text-pretty">
              Uninsured tail exposure of $2.4M is concentrated in BB-rated agents under active monitoring.
            </div>
          </div>
        </Panel>
      </div>

      {/* Incidents */}
      <Panel className="mt-4">
        <PanelHeader title="Historical incidents" description="Trailing 12 months" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Agent</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Severity</th>
                <th className="px-5 py-3 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {incidents.map((i) => (
                <tr key={i.date} className="hover:bg-secondary/30">
                  <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{i.date}</td>
                  <td className="px-5 py-3.5 font-medium text-card-foreground">{i.agent}</td>
                  <td className="px-5 py-3.5 text-muted-foreground">{i.type}</td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                        i.severity === "High"
                          ? "border-destructive/30 bg-destructive/15 text-destructive"
                          : i.severity === "Medium"
                            ? "border-warning/30 bg-warning/15 text-warning"
                            : "border-border bg-secondary text-muted-foreground"
                      }`}
                    >
                      {i.severity}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                      <span className="size-1.5 rounded-full bg-success" /> Resolved
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

function CoverageRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium text-card-foreground">{value}</span>
    </div>
  )
}
