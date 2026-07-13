import { Umbrella, ShieldCheck, Landmark, FileText } from "lucide-react"
import { Panel, PanelHeader, PageHeader, StatCard, Progress } from "@/components/ui-kit"

const pools = [
  { name: "Default Protection Pool", capital: "$8.4M", utilization: 42, apy: "9.2%", underwriters: 214 },
  { name: "Third-Party Underwriters", capital: "$2.1M", utilization: 61, apy: "7.4%", underwriters: 38 },
  { name: "Collateral Reserve", capital: "$1.3M", utilization: 18, apy: "4.1%", underwriters: 1 },
]

const policies = [
  { id: "POL-4821", agent: "Atlas-7 Research Agent", coverage: "$25,000", premium: "$38/mo", status: "Active" },
  { id: "POL-4802", agent: "Nova Compute Agent", coverage: "$82,000", premium: "$120/mo", status: "Active" },
  { id: "POL-4788", agent: "Cobalt Trading Agent", coverage: "$9,000", premium: "$52/mo", status: "Under review" },
  { id: "POL-4771", agent: "Helix Data Market", coverage: "$64,000", premium: "$94/mo", status: "Active" },
]

export default function InsurancePage() {
  return (
    <div>
      <PageHeader
        eyebrow="Insurance"
        title="Credit default coverage"
        description="Decentralized insurance pools backing agent credit lines against default and SLA-breach events."
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total coverage" value="$11.8M" hint="83% of exposure" accent={<Umbrella className="size-4 text-muted-foreground" />} />
        <StatCard label="Active policies" value="1,204" delta="+38" deltaTone="up" hint="30d" accent={<FileText className="size-4 text-muted-foreground" />} />
        <StatCard label="Claims paid (YTD)" value="$412K" hint="9 claims" accent={<Landmark className="size-4 text-muted-foreground" />} />
        <StatCard label="Pool solvency" value="238" unit="%" delta="Healthy" deltaTone="up" accent={<ShieldCheck className="size-4 text-success" />} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {pools.map((p) => (
          <Panel key={p.name} className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-card-foreground">{p.name}</h3>
              <span className="font-mono text-xs text-success">{p.apy} APY</span>
            </div>
            <p className="mt-3 font-mono text-2xl font-semibold text-card-foreground">{p.capital}</p>
            <p className="text-xs text-muted-foreground">Pool capital</p>
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Utilization</span>
                <span className="font-mono text-card-foreground">{p.utilization}%</span>
              </div>
              <Progress value={p.utilization} tone={p.utilization > 60 ? "warning" : "primary"} className="mt-2" />
            </div>
            <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
              {p.underwriters} underwriter{p.underwriters > 1 ? "s" : ""}
            </p>
          </Panel>
        ))}
      </div>

      <Panel>
        <PanelHeader title="Active policies" description="Coverage issued against open credit lines" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Policy</th>
                <th className="px-5 py-3 font-medium">Agent</th>
                <th className="px-5 py-3 font-medium">Coverage</th>
                <th className="px-5 py-3 font-medium">Premium</th>
                <th className="px-5 py-3 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {policies.map((p) => (
                <tr key={p.id} className="hover:bg-secondary/30">
                  <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{p.id}</td>
                  <td className="px-5 py-3.5 font-medium text-card-foreground">{p.agent}</td>
                  <td className="px-5 py-3.5 font-mono text-card-foreground">{p.coverage}</td>
                  <td className="px-5 py-3.5 text-muted-foreground">{p.premium}</td>
                  <td className="px-5 py-3.5 text-right">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${
                        p.status === "Active"
                          ? "border-success/30 bg-success/15 text-success"
                          : "border-warning/30 bg-warning/15 text-warning"
                      }`}
                    >
                      <span className="size-1.5 rounded-full bg-current" />
                      {p.status}
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
