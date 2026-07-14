'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { getAgents } from '@/app/actions/agents'

type Breakdown = {
  performance: number
  reliability: number
  reputation: number
  risk: number
  completedTasks: number
  failedTasks: number
}

type AgentRow = {
  id: string
  name: string
  walletAddress: string
  creditScore: string
  creditRating: string | null
  riskRating: string | null
}

export default function CreditScoresPage() {
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [breakdowns, setBreakdowns] = useState<Record<string, Breakdown | null>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getAgents()
        setAgents(data as AgentRow[])

        const entries = await Promise.all(
          data.map(async (a: AgentRow) => {
            const res = await fetch(`/api/agents/${a.id}/credit-history`)
            if (!res.ok) return [a.id, null] as const
            const { history } = await res.json()
            return [a.id, history[0]?.breakdown ?? null] as const
          }),
        )
        setBreakdowns(Object.fromEntries(entries))
      } catch (error) {
        console.error('[v0] Error:', error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <div className="p-8">Loading...</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Credit Scores</h1>
        <p className="text-muted-foreground">How creditworthiness is calculated from weighted behavioral factors</p>
      </div>

      <div className="space-y-4">
        {agents.map((agent) => {
          const unrated = agent.creditRating === 'unrated'
          const breakdown = breakdowns[agent.id]
          return (
            <div key={agent.id} className="border border-border rounded-lg p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h3 className="font-bold text-xl">{agent.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{agent.walletAddress?.substring(0, 20)}...</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-4xl font-bold">
                    {unrated ? '—' : Math.round(parseFloat(agent.creditScore))}
                  </p>
                  <p className="text-xs text-muted-foreground">{unrated ? 'unrated' : '/ 990'}</p>
                </div>
              </div>

              {breakdown ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                  <Factor label="Performance" value={breakdown.performance.toFixed(1)} weight="40%" />
                  <Factor label="Reliability" value={breakdown.reliability.toFixed(1)} weight="30%" />
                  <Factor label="Reputation" value={breakdown.reputation.toFixed(1)} weight="20%" />
                  <Factor label="Risk" value={breakdown.risk.toFixed(1)} weight="10%" />
                </div>
              ) : (
                <div className="mb-6 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No behavioral history yet. Factors populate after this agent completes its first task,
                  repayment, or job.{' '}
                  <Link href="/profile" className="text-primary hover:underline">
                    Run a task →
                  </Link>
                </div>
              )}

              <div className="border-t border-border pt-4">
                <p className="text-sm font-medium mb-2">Assessment</p>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Risk Rating</p>
                  <span className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-primary/15 text-primary font-medium text-sm">
                    {agent.riskRating}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {agents.length > 0 && (
        <Link
          href="/transactions"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 font-medium"
        >
          Open Credit Line <ArrowUpRight className="size-4" />
        </Link>
      )}
    </div>
  )
}

function Factor({ label, value, weight }: { label: string; value: string; weight: string }) {
  return (
    <div className="p-3 bg-secondary/50 rounded">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold mt-2">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{weight}</p>
    </div>
  )
}
