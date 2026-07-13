export type Rating = "AAA" | "AA" | "A" | "BBB" | "BB" | "B"
export type RiskLevel = "Low" | "Moderate" | "Elevated" | "High"

export const agent = {
  name: "Atlas-7 Research Agent",
  handle: "atlas-7.agent.eth",
  wallet: "0x8F3a...D29c",
  fullWallet: "0x8F3a17c4e9B21fF0aC5e8D4b7A63c1E9002dD29c",
  verified: true,
  model: "GPT-5 Turbo / Claude 4.1 Ensemble",
  modelVersion: "v4.2.1",
  network: "Base L2 · USDC",
  created: "March 12, 2024",
  owner: "Meridian Labs (KYB Verified)",
  rating: "AA" as Rating,
  score: 872,
  creditLimit: 25000,
  usedCredit: 8400,
  riskLevel: "Low" as RiskLevel,
  defaultProbability: 1.8,
}

export const creditScoreTrend = [
  { month: "Jan", score: 741 },
  { month: "Feb", score: 758 },
  { month: "Mar", score: 769 },
  { month: "Apr", score: 782 },
  { month: "May", score: 803 },
  { month: "Jun", score: 811 },
  { month: "Jul", score: 826 },
  { month: "Aug", score: 838 },
  { month: "Sep", score: 845 },
  { month: "Oct", score: 859 },
  { month: "Nov", score: 866 },
  { month: "Dec", score: 872 },
]

export const performanceHistory = [
  { month: "Jan", tasks: 1240, success: 96.1 },
  { month: "Feb", tasks: 1388, success: 96.8 },
  { month: "Mar", tasks: 1502, success: 97.2 },
  { month: "Apr", tasks: 1610, success: 97.0 },
  { month: "May", tasks: 1744, success: 98.1 },
  { month: "Jun", tasks: 1820, success: 98.4 },
  { month: "Jul", tasks: 1955, success: 98.6 },
  { month: "Aug", tasks: 2088, success: 98.9 },
  { month: "Sep", tasks: 2140, success: 99.0 },
  { month: "Oct", tasks: 2295, success: 99.2 },
  { month: "Nov", tasks: 2410, success: 99.3 },
  { month: "Dec", tasks: 2512, success: 99.4 },
]

export type Transaction = {
  id: string
  counterparty: string
  type: "Credit Draw" | "Repayment" | "Interest" | "Collateral" | "Settlement"
  amount: number
  status: "Settled" | "Pending" | "Active"
  time: string
}

export const recentTransactions: Transaction[] = [
  { id: "TX-90412", counterparty: "Nova Compute Agent", type: "Credit Draw", amount: 3200, status: "Active", time: "2h ago" },
  { id: "TX-90408", counterparty: "Helix Data Market", type: "Settlement", amount: 1450, status: "Settled", time: "6h ago" },
  { id: "TX-90397", counterparty: "Ledgermind Treasury", type: "Repayment", amount: -2800, status: "Settled", time: "1d ago" },
  { id: "TX-90385", counterparty: "Orbit API Gateway", type: "Interest", amount: -42, status: "Settled", time: "1d ago" },
  { id: "TX-90372", counterparty: "Vertex Inference", type: "Credit Draw", amount: 5000, status: "Active", time: "2d ago" },
  { id: "TX-90361", counterparty: "Meridian Collateral Vault", type: "Collateral", amount: 5000, status: "Settled", time: "3d ago" },
]

export const attestations = [
  { issuer: "Ethereum Attestation Service", claim: "Identity Verified", date: "Mar 2024", weight: "High" },
  { issuer: "Meridian Labs", claim: "Owner KYB Complete", date: "Mar 2024", weight: "High" },
  { issuer: "Nova Compute Agent", claim: "12 Contracts Fulfilled", date: "Ongoing", weight: "Medium" },
  { issuer: "Helix Data Market", claim: "Zero Disputes (Q3)", date: "Sep 2024", weight: "Medium" },
  { issuer: "AgentAudit DAO", claim: "SLA Compliance ≥ 99%", date: "Oct 2024", weight: "High" },
]

export const scoreFactors = [
  {
    key: "Performance",
    weight: 40,
    score: 94,
    color: "chart-1",
    items: [
      { label: "Task success rate", value: "99.4%", contribution: 96 },
      { label: "Execution quality", value: "A+", contribution: 92 },
    ],
  },
  {
    key: "Reliability",
    weight: 30,
    score: 91,
    color: "chart-2",
    items: [
      { label: "Payment history", value: "100% on-time", contribution: 98 },
      { label: "Contract completion", value: "241 / 244", contribution: 84 },
    ],
  },
  {
    key: "Reputation",
    weight: 20,
    score: 88,
    color: "chart-3",
    items: [{ label: "Third-party attestations", value: "5 verified", contribution: 88 }],
  },
  {
    key: "Risk",
    weight: 10,
    score: 82,
    color: "chart-4",
    items: [{ label: "Failure probability", value: "1.8%", contribution: 82 }],
  },
]

export const riskFactors = [
  { label: "Concentration risk", level: "Low", note: "No single counterparty exceeds 22% of exposure." },
  { label: "Liquidity coverage", level: "Strong", note: "Collateral ratio at 1.4x outstanding credit." },
  { label: "Behavioral drift", level: "Low", note: "Model outputs stable across last 90 days." },
  { label: "Dispute exposure", level: "Minimal", note: "1 resolved dispute in trailing 12 months." },
]

export const defaultProbabilitySeries = [
  { month: "Jun", portfolio: 3.1, agent: 2.4 },
  { month: "Jul", portfolio: 2.9, agent: 2.2 },
  { month: "Aug", portfolio: 2.8, agent: 2.1 },
  { month: "Sep", portfolio: 2.6, agent: 2.0 },
  { month: "Oct", portfolio: 2.5, agent: 1.9 },
  { month: "Nov", portfolio: 2.4, agent: 1.9 },
  { month: "Dec", portfolio: 2.3, agent: 1.8 },
]

export const riskDistribution = [
  { band: "AAA", count: 142, fill: "var(--color-chart-2)" },
  { band: "AA", count: 318, fill: "var(--color-chart-1)" },
  { band: "A", count: 526, fill: "var(--color-chart-3)" },
  { band: "BBB", count: 274, fill: "var(--color-chart-5)" },
  { band: "BB", count: 118, fill: "var(--color-chart-4)" },
  { band: "B", count: 43, fill: "var(--color-destructive)" },
]

export const portfolioExposure = [
  { sector: "Compute", value: 4.2 },
  { sector: "Data", value: 3.1 },
  { sector: "Inference", value: 2.7 },
  { sector: "Storage", value: 1.9 },
  { sector: "Orchestration", value: 1.4 },
  { sector: "Payments", value: 0.9 },
]

export const incidents = [
  { date: "Nov 18, 2024", agent: "Cobalt Trading Agent", type: "Late repayment", severity: "Medium", resolved: true },
  { date: "Sep 04, 2024", agent: "Pyxis Scraper", type: "SLA breach", severity: "Low", resolved: true },
  { date: "Jul 22, 2024", agent: "Drift Model v2", type: "Default event", severity: "High", resolved: true },
  { date: "May 11, 2024", agent: "Echo Voice Agent", type: "Dispute filed", severity: "Low", resolved: true },
]

export type MarketAgent = {
  name: string
  specialization: string
  rating: Rating
  reliability: number
  cost: number
  availableCredit: number
  network: string
}

export const marketplaceAgents: MarketAgent[] = [
  { name: "Atlas-7 Research Agent", specialization: "Market & web research", rating: "AA", reliability: 99.2, cost: 20, availableCredit: 16600, network: "Base" },
  { name: "Nova Compute Agent", specialization: "GPU orchestration", rating: "AAA", reliability: 99.7, cost: 45, availableCredit: 82000, network: "Base" },
  { name: "Helix Data Market", specialization: "Dataset sourcing", rating: "AAA", reliability: 99.5, cost: 32, availableCredit: 64000, network: "Optimism" },
  { name: "Vertex Inference", specialization: "LLM inference relay", rating: "AA", reliability: 98.9, cost: 28, availableCredit: 38500, network: "Base" },
  { name: "Orbit API Gateway", specialization: "3rd-party API access", rating: "A", reliability: 97.4, cost: 15, availableCredit: 12000, network: "Arbitrum" },
  { name: "Cobalt Trading Agent", specialization: "DeFi execution", rating: "BBB", reliability: 95.1, cost: 60, availableCredit: 9000, network: "Base" },
  { name: "Pyxis Scraper", specialization: "Structured extraction", rating: "A", reliability: 96.8, cost: 12, availableCredit: 7500, network: "Optimism" },
  { name: "Echo Voice Agent", specialization: "Voice & transcription", rating: "AA", reliability: 98.3, cost: 22, availableCredit: 21000, network: "Base" },
]

export const creditRequest = {
  requester: "Nova Compute Agent",
  requesterHandle: "nova-compute.agent.eth",
  requesterRating: "AAA" as Rating,
  amount: 5000,
  purpose: "Compute resources",
  period: 30,
  risk: "Low" as RiskLevel,
  collateral: 20,
  apr: 6.4,
  interestEstimate: 26.3,
}
