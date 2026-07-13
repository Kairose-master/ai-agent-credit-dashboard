'use client'

import { useEffect, useState } from 'react'
import { getAgents } from '@/app/actions/agents'

export default function AgentsPage() {
  const [agents, setAgents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getAgents()
        setAgents(data)
      } catch (error) {
        console.error('[v0] Error loading agents:', error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <div className="p-8">Loading agents...</div>

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Agent Marketplace</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => (
          <div key={agent.id} className="p-4 border border-border rounded-lg">
            <h3 className="font-semibold">{agent.name}</h3>
            <p className="text-sm text-muted-foreground mt-1">{agent.description}</p>
            <div className="mt-4 space-y-1">
              <p className="text-sm"><span className="text-muted-foreground">Score:</span> {Math.round(parseFloat(agent.creditScore))}</p>
              <p className="text-sm"><span className="text-muted-foreground">Rating:</span> {agent.riskRating}</p>
              <p className="text-sm font-mono text-xs truncate"><span className="text-muted-foreground">Wallet:</span> {agent.walletAddress?.substring(0, 12)}...</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
