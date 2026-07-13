'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { getAgents } from '@/app/actions/agents'
import { seedDemoData } from '@/app/actions/seed'

export default function DashboardPage() {
  const [agents, setAgents] = useState<any[]>([])
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const init = async () => {
      try {
        const session = await authClient.getSession()
        setUser(session?.user)

        // Seed demo data
        await seedDemoData().catch(() => {})

        // Load agents
        const data = await getAgents()
        setAgents(data)
      } catch (error) {
        console.error('[v0] Error:', error)
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [])

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
        <h2 className="text-xl font-semibold mb-4">Your Agents ({agents.length})</h2>
        {agents.length === 0 ? (
          <p className="text-muted-foreground">No agents found. Create one to get started.</p>
        ) : (
          <ul className="space-y-3">
            {agents.map((agent) => (
              <li key={agent.id} className="flex items-center justify-between p-3 border border-border rounded">
                <div>
                  <p className="font-medium">{agent.name}</p>
                  <p className="text-sm text-muted-foreground">{agent.walletAddress?.substring(0, 12)}...</p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-medium">{Math.round(parseFloat(agent.creditScore))}</p>
                  <p className="text-xs text-muted-foreground">{agent.riskRating}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/profile" className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-secondary/50">
          <span>View Agent Profile</span>
          <ArrowUpRight className="size-4" />
        </Link>
        <Link href="/transactions" className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-secondary/50">
          <span>Manage Transactions</span>
          <ArrowUpRight className="size-4" />
        </Link>
        <Link href="/credit-scores" className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-secondary/50">
          <span>View Credit Scores</span>
          <ArrowUpRight className="size-4" />
        </Link>
        <Link href="/risk" className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-secondary/50">
          <span>Risk Analytics</span>
          <ArrowUpRight className="size-4" />
        </Link>
      </div>
    </div>
  )
}
