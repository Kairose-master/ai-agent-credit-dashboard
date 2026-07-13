import type React from "react"
import { cn } from "@/lib/utils"
import type { Rating, RiskLevel } from "@/lib/data"

export function Panel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-card", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function PanelHeader({
  title,
  description,
  action,
  className,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-border px-5 py-4", className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold tracking-tight text-card-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground text-balance">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground text-pretty">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}

const ratingStyles: Record<string, string> = {
  AAA: "bg-success/15 text-success border-success/30",
  AA: "bg-success/15 text-success border-success/30",
  A: "bg-primary/15 text-primary border-primary/30",
  BBB: "bg-warning/15 text-warning border-warning/30",
  BB: "bg-warning/15 text-warning border-warning/30",
  B: "bg-destructive/15 text-destructive border-destructive/30",
}

export function RatingBadge({ rating, className }: { rating: Rating; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs font-bold tracking-wide",
        ratingStyles[rating] ?? ratingStyles.A,
        className,
      )}
    >
      {rating}
    </span>
  )
}

const riskStyles: Record<string, string> = {
  Low: "bg-success/15 text-success border-success/30",
  Minimal: "bg-success/15 text-success border-success/30",
  Strong: "bg-success/15 text-success border-success/30",
  Moderate: "bg-warning/15 text-warning border-warning/30",
  Elevated: "bg-warning/15 text-warning border-warning/30",
  High: "bg-destructive/15 text-destructive border-destructive/30",
}

export function RiskBadge({ level, className }: { level: RiskLevel | string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        riskStyles[level] ?? riskStyles.Moderate,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {level}
    </span>
  )
}

export function StatCard({
  label,
  value,
  unit,
  delta,
  deltaTone = "up",
  hint,
  accent,
}: {
  label: string
  value: string
  unit?: string
  delta?: string
  deltaTone?: "up" | "down" | "neutral"
  hint?: string
  accent?: React.ReactNode
}) {
  const toneClass =
    deltaTone === "up" ? "text-success" : deltaTone === "down" ? "text-destructive" : "text-muted-foreground"
  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {accent}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-semibold tracking-tight text-card-foreground">{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {delta && <span className={cn("text-xs font-medium", toneClass)}>{delta}</span>}
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
    </Panel>
  )
}

export function Progress({ value, className, tone = "primary" }: { value: number; className?: string; tone?: string }) {
  const toneClass =
    tone === "success"
      ? "bg-success"
      : tone === "warning"
        ? "bg-warning"
        : tone === "destructive"
          ? "bg-destructive"
          : "bg-primary"
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-secondary", className)}>
      <div className={cn("h-full rounded-full", toneClass)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}
