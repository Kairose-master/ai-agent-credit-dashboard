"use client"

import { useState } from "react"
import Link from "next/link"
import { Search, Wallet, Zap, Clock, ArrowUpRight, SlidersHorizontal } from "lucide-react"
import { Panel, PageHeader, RatingBadge } from "@/components/ui-kit"
import { marketplaceAgents } from "@/lib/data"

const filters = ["All ratings", "AAA", "AA", "A", "BBB"] as const

function fmtUsd(n: number) {
  return n.toLocaleString("en-US")
}

export default function MarketplacePage() {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<(typeof filters)[number]>("All ratings")

  const results = marketplaceAgents.filter((a) => {
    const matchesQuery =
      a.name.toLowerCase().includes(query.toLowerCase()) ||
      a.specialization.toLowerCase().includes(query.toLowerCase())
    const matchesFilter = filter === "All ratings" || a.rating === filter
    return matchesQuery && matchesFilter
  })

  return (
    <div>
      <PageHeader
        eyebrow="Agent Marketplace"
        title="Discover creditworthy agents"
        description="Browse the emerging agent economy. Every agent carries a verifiable credit rating and available credit line."
        action={
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs text-muted-foreground">
            {marketplaceAgents.length} agents listed
          </span>
        }
      />

      {/* Controls */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or specialization..."
            className="h-10 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <SlidersHorizontal className="mr-0.5 size-4 shrink-0 text-muted-foreground" />
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                filter === f
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {results.map((a) => (
          <Panel key={a.name} className="flex flex-col p-5 transition hover:border-primary/40">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-lg bg-primary/15 font-mono text-sm font-bold text-primary">
                  {a.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-card-foreground">{a.name}</h3>
                  <p className="text-xs text-muted-foreground">{a.specialization}</p>
                </div>
              </div>
              <RatingBadge rating={a.rating} />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Metric icon={<Zap className="size-3.5" />} label="Reliability" value={`${a.reliability}%`} />
              <Metric icon={<Clock className="size-3.5" />} label="Hourly cost" value={`$${a.cost}`} />
              <Metric
                icon={<Wallet className="size-3.5" />}
                label="Available credit"
                value={`$${fmtUsd(a.availableCredit)}`}
              />
              <Metric label="Network" value={a.network} />
            </div>

            <div className="mt-5 flex items-center gap-2 border-t border-border pt-4">
              <Link
                href="/profile"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-secondary/50 py-2 text-xs font-medium text-foreground hover:bg-secondary"
              >
                View profile
              </Link>
              <Link
                href="/transactions"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                Hire agent <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
          </Panel>
        ))}
      </div>

      {results.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">No agents match your filters.</p>
        </div>
      )}
    </div>
  )
}

function Metric({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon} {label}
      </p>
      <p className="mt-1 font-mono text-sm font-semibold text-card-foreground">{value}</p>
    </div>
  )
}
