"use client"

import { useState } from "react"
import {
  ArrowDownLeft,
  Check,
  X,
  Clock,
  ShieldCheck,
  Coins,
  Percent,
  CalendarClock,
  BadgeCheck,
} from "lucide-react"
import { Panel, PanelHeader, PageHeader, RatingBadge, RiskBadge } from "@/components/ui-kit"
import { creditRequest, recentTransactions } from "@/lib/data"

type Decision = "pending" | "approved" | "rejected"

function fmtUsd(n: number) {
  return n.toLocaleString("en-US")
}

export default function TransactionPage() {
  const [decision, setDecision] = useState<Decision>("pending")
  const r = creditRequest

  return (
    <div>
      <PageHeader
        eyebrow="Credit Transaction"
        title="Agent-to-agent credit request"
        description="Review and settle an incoming request for a short-term USDC credit line."
        action={
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" /> Expires in 4h 12m
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Request details */}
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Request details"
            action={<span className="font-mono text-xs text-muted-foreground">REQ-40219</span>}
          />
          <div className="p-5">
            {/* Requester */}
            <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <ArrowDownLeft className="size-5" />
                </div>
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
                    {r.requester}
                    <BadgeCheck className="size-3.5 text-primary" />
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{r.requesterHandle}</p>
                </div>
              </div>
              <div className="text-right">
                <RatingBadge rating={r.requesterRating} />
                <p className="mt-1 text-[11px] text-muted-foreground">Requesting party</p>
              </div>
            </div>

            {/* Amount headline */}
            <div className="mt-5 flex flex-col items-center gap-1 py-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Requested amount</p>
              <p className="font-mono text-4xl font-semibold tracking-tight text-card-foreground">
                ${fmtUsd(r.amount)}
              </p>
              <p className="text-sm text-muted-foreground">USDC</p>
            </div>

            {/* Detail grid */}
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
              <DetailCell icon={<Coins className="size-4" />} label="Purpose" value={r.purpose} />
              <DetailCell icon={<CalendarClock className="size-4" />} label="Credit period" value={`${r.period} days`} />
              <DetailCell
                icon={<ShieldCheck className="size-4" />}
                label="Risk assessment"
                value={<RiskBadge level={r.risk} />}
              />
              <DetailCell icon={<Percent className="size-4" />} label="Collateral" value={`${r.collateral}%`} />
              <DetailCell icon={<Percent className="size-4" />} label="APR" value={`${r.apr}%`} />
              <DetailCell
                icon={<Coins className="size-4" />}
                label="Est. interest"
                value={`$${r.interestEstimate}`}
              />
            </div>
          </div>
        </Panel>

        {/* Decision panel */}
        <Panel className="flex flex-col">
          <PanelHeader title="Decision" />
          <div className="flex flex-1 flex-col p-5">
            {decision === "pending" && (
              <>
                <div className="space-y-3 text-sm">
                  <SummaryRow label="Principal" value={`$${fmtUsd(r.amount)}`} />
                  <SummaryRow label="Collateral posted" value={`$${fmtUsd((r.amount * r.collateral) / 100)}`} />
                  <SummaryRow label="Interest (30d)" value={`$${r.interestEstimate}`} />
                  <div className="border-t border-border pt-3">
                    <SummaryRow label="Total repayment" value={`$${fmtUsd(r.amount + r.interestEstimate)}`} strong />
                  </div>
                </div>
                <div className="mt-6 flex flex-col gap-2.5">
                  <button
                    onClick={() => setDecision("approved")}
                    className="flex items-center justify-center gap-2 rounded-md bg-success py-2.5 text-sm font-semibold text-success-foreground transition hover:opacity-90"
                  >
                    <Check className="size-4" /> Approve Credit
                  </button>
                  <button
                    onClick={() => setDecision("rejected")}
                    className="flex items-center justify-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 py-2.5 text-sm font-semibold text-destructive transition hover:bg-destructive/20"
                  >
                    <X className="size-4" /> Reject Request
                  </button>
                </div>
                <p className="mt-4 text-center text-[11px] text-muted-foreground text-pretty">
                  Approval executes an on-chain smart contract and locks collateral automatically.
                </p>
              </>
            )}

            {decision === "approved" && (
              <ResultState
                tone="success"
                icon={<Check className="size-7" />}
                title="Credit approved"
                message={`$${fmtUsd(r.amount)} USDC credit line opened for ${r.requester}. Collateral locked on-chain.`}
                onReset={() => setDecision("pending")}
              />
            )}

            {decision === "rejected" && (
              <ResultState
                tone="destructive"
                icon={<X className="size-7" />}
                title="Request rejected"
                message={`The credit request from ${r.requester} has been declined. The requester has been notified.`}
                onReset={() => setDecision("pending")}
              />
            )}
          </div>
        </Panel>
      </div>

      {/* Activity ledger */}
      <Panel className="mt-4">
        <PanelHeader title="Credit line activity" description="Settlement ledger" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">ID</th>
                <th className="px-5 py-3 font-medium">Counterparty</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recentTransactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-secondary/30">
                  <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{tx.id}</td>
                  <td className="px-5 py-3.5 font-medium text-card-foreground">{tx.counterparty}</td>
                  <td className="px-5 py-3.5 text-muted-foreground">{tx.type}</td>
                  <td className="px-5 py-3.5">
                    <StatusPill status={tx.status} />
                  </td>
                  <td
                    className={`px-5 py-3.5 text-right font-mono font-medium ${
                      tx.amount < 0 ? "text-muted-foreground" : "text-success"
                    }`}
                  >
                    {tx.amount < 0 ? "-" : "+"}${fmtUsd(Math.abs(tx.amount))}
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

function DetailCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="bg-card p-4">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </p>
      <div className="mt-1.5 text-sm font-medium text-card-foreground">{value}</div>
    </div>
  )
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${strong ? "text-base font-semibold text-card-foreground" : "text-card-foreground"}`}>
        {value}
      </span>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Settled: "border-border bg-secondary text-muted-foreground",
    Pending: "border-warning/30 bg-warning/15 text-warning",
    Active: "border-success/30 bg-success/15 text-success",
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {status}
    </span>
  )
}

function ResultState({
  tone,
  icon,
  title,
  message,
  onReset,
}: {
  tone: "success" | "destructive"
  icon: React.ReactNode
  title: string
  message: string
  onReset: () => void
}) {
  const toneClass = tone === "success" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
      <div className={`flex size-14 items-center justify-center rounded-full ${toneClass}`}>{icon}</div>
      <h3 className="mt-4 text-base font-semibold text-card-foreground">{title}</h3>
      <p className="mt-1.5 max-w-xs text-sm text-muted-foreground text-pretty">{message}</p>
      <button
        onClick={onReset}
        className="mt-6 rounded-md border border-border bg-secondary/50 px-4 py-2 text-xs font-medium text-foreground hover:bg-secondary"
      >
        Review another request
      </button>
    </div>
  )
}
