"use client"

import type React from "react"
import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  Bot,
  Gauge,
  ArrowLeftRight,
  ShieldAlert,
  Umbrella,
  Settings,
  Search,
  Bell,
  Menu,
  X,
  Command,
  ChevronsUpDown,
  LogOut,
} from "lucide-react"
import { cn } from "@/lib/utils"

const nav = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Agents", href: "/agents", icon: Bot },
  { label: "Credit Scores", href: "/credit-scores", icon: Gauge },
  { label: "Transactions", href: "/transactions", icon: ArrowLeftRight },
  { label: "Risk Analytics", href: "/risk", icon: ShieldAlert },
  { label: "Insurance", href: "/insurance", icon: Umbrella },
  { label: "Settings", href: "/settings", icon: Settings },
]

function Sidebar({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <span className="font-mono text-sm font-bold">L</span>
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight text-sidebar-foreground">Ledgermind</p>
          <p className="text-[11px] text-muted-foreground">Agent Credit Layer</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Platform
        </p>
        {nav.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
              {active && <span className="ml-auto size-1.5 rounded-full bg-primary" />}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">Network status</span>
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-success">
              <span className="size-1.5 rounded-full bg-success" /> Live
            </span>
          </div>
          <p className="mt-2 font-mono text-xs text-sidebar-foreground">Base L2 · Block 21,884,201</p>
        </div>
        <button className="mt-3 flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent/50">
          <div className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
            ML
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium text-sidebar-foreground">Meridian Labs</p>
            <p className="truncate text-[11px] text-muted-foreground">Institutional</p>
          </div>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  )
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const handleLogout = async () => {
    // Clear session cookie on client-side for now
    document.cookie = 'auth_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;'
    router.push('/sign-in')
    router.refresh()
  }

  return (
    <div className="min-h-svh bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-sidebar-border bg-sidebar lg:block">
        <Sidebar pathname={pathname} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-sidebar-border bg-sidebar">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent"
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
            <Sidebar pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md md:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-secondary lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="size-4" />
          </button>

          <div className="relative hidden max-w-md flex-1 md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search agents, wallets, transactions..."
              className="h-9 w-full rounded-md border border-border bg-secondary/50 pl-9 pr-16 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <Command className="size-3" /> K
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground sm:flex">
              <span className="size-1.5 rounded-full bg-success" /> USDC Treasury: $2.41M
            </span>
            <button
              className="relative flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-secondary"
              aria-label="Notifications"
            >
              <Bell className="size-4" />
              <span className="absolute right-2 top-2 size-1.5 rounded-full bg-destructive" />
            </button>
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary hover:opacity-80"
              >
                A7
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-40 rounded-md border border-border bg-background shadow-lg">
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-secondary"
                  >
                    <LogOut className="size-4" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
