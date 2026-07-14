'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Plus, Loader2, Radio, Briefcase, Store, ShoppingCart, CheckCircle2 } from 'lucide-react'
import { getAgents, bootstrapFirstAgent, createAgent } from '@/app/actions/agents'
import { getPlatformFeed } from '@/app/actions/feed'

type FeedEvent = { id: string; kind: string; summary: string; createdAt: string | Date }

const FEED_ICON: Record<string, typeof Briefcase> = {
  JOB_POSTED: Briefcase,
  JOB_COMPLETED: CheckCircle2,
  TEMPLATE_PUBLISHED: Store,
  TEMPLATE_PURCHASED: ShoppingCart,
}

function LiveActivityFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      getPlatformFeed(15)
        .then((rows) => {
          if (!cancelled) setEvents(rows as FeedEvent[])
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    load()
    const interval = setInterval(load, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <Radio className="size-5 text-success" /> Live Activity
      </h2>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No platform activity yet — post a job or publish a template.</p>
      ) : (
        <ul className="space-y-3">
          {events.map((e) => {
            const Icon = FEED_ICON[e.kind] ?? Radio
            return (
              <li key={e.id} className="flex items-start gap-3 text-sm">
                <Icon className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate">{e.summary}</p>
                  <p className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const [agents, setAgents] = useState<any[]>([])
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const load = async () => {
    const data = await getAgents()
    setAgents(data)
  }

  useEffect(() => {
    const init = async () => {
      try {
        const me = await fetch('/api/me')
        if (me.ok) setUser((await me.json()).user)

        // Give first-time users a single cold-start agent (score 0, unrated)
        await bootstrapFirstAgent().catch(() => {})

        await load()
      } catch (error) {
        console.error('[v0] Error:', error)
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [])

  const handleCreate = async () => {
    setCreateBusy(true)
    setCreateError(null)
    try {
      const { id } = await createAgent({ name: newName, description: newDescription })
      setNewName('')
      setNewDescription('')
      setCreating(false)
      await load()
      window.location.href = `/profile?agent=${id}`
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error))
    } finally {
      setCreateBusy(false)
    }
  }

  if (loading) {
    return <div className="p-8 text-center">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Welcome, {user?.name || 'Agent Manager'}</h1>
        <p className="mt-2 text-muted-foreground">Manage your AI agents and credit infrastructure</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Your Agents ({agents.length})</h2>
          <button
            onClick={() => setCreating((v) => !v)}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-secondary"
          >
            <Plus className="size-4" /> New Agent
          </button>
        </div>

        {creating && (
          <div className="mb-4 rounded-md border border-border p-4 space-y-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Agent name"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What is this agent for? (optional)"
              rows={2}
              className="w-full rounded-md border border-border bg-background p-3 text-sm"
            />
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={createBusy || !newName.trim()}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {createBusy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Create
              </button>
              <button
                onClick={() => setCreating(false)}
                className="rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary"
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Every new agent starts at a genuine cold start (score 0, unrated) — no fabricated
              numbers. Provision its smart account and run a task from its profile to start
              building credit.
            </p>
          </div>
        )}

        {agents.length === 0 ? (
          <p className="text-muted-foreground">No agents found. Create one to get started.</p>
        ) : (
          <ul className="space-y-3">
            {agents.map((agent) => {
              const unrated = agent.creditRating === 'unrated'
              return (
                <li key={agent.id}>
                  <Link
                    href={`/profile?agent=${agent.id}`}
                    className="flex items-center justify-between p-3 border border-border rounded hover:bg-secondary/50"
                  >
                    <div>
                      <p className="font-medium">{agent.name}</p>
                      <p className="text-sm text-muted-foreground">{agent.walletAddress?.substring(0, 12)}...</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-medium">
                        {unrated ? '—' : Math.round(parseFloat(agent.creditScore))}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {unrated ? 'No history yet' : agent.riskRating}
                      </p>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/profile" className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-secondary/50">
          <span>View Agent Profile</span>
          <ArrowUpRight className="size-4" />
        </Link>
        <Link href="/jobs" className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-secondary/50">
          <span>Labor Market & Templates</span>
          <ArrowUpRight className="size-4" />
        </Link>
        <Link href="/credit-scores" className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-secondary/50">
          <span>View Credit Scores</span>
          <ArrowUpRight className="size-4" />
        </Link>
        <Link href="/guide" className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-secondary/50">
          <span>Read the Guide</span>
          <ArrowUpRight className="size-4" />
        </Link>
      </div>

      <LiveActivityFeed />
    </div>
  )
}
