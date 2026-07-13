'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { getAgents } from '@/app/actions/agents'

export default function CreditScoresPage() {
  const [agents, setAgents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getAgents()
        setAgents(data)
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
        <p className="text-muted-foreground">How creditworthiness is calculated from weighted factors</p>
      </div>

      <div className="space-y-4">
        {agents.map((agent) => (
          <div key={agent.id} className="border border-border rounded-lg p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h3 className="font-bold text-xl">{agent.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">{agent.walletAddress?.substring(0, 20)}...</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-4xl font-bold">{Math.round(parseFloat(agent.creditScore))}</p>
                <p className="text-xs text-muted-foreground">/ 100</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Factor label="On-Chain Activity" value="50" weight="25%" />
              <Factor label="Transaction History" value="60" weight="35%" />
              <Factor label="Collateral Score" value="45" weight="20%" />
              <Factor label="Attestation Score" value="55" weight="20%" />
            </div>

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
        ))}
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
