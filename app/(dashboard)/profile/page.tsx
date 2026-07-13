'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Wallet, CalendarDays, ShieldCheck, Cpu } from 'lucide-react'
import { getAgents } from '@/app/actions/agents'

export default function ProfilePage() {
  const [agent, setAgent] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const agents = await getAgents()
        if (agents.length > 0) setAgent(agents[0])
      } catch (error) {
        console.error('[v0] Error:', error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <div className="p-8">Loading...</div>
  if (!agent) return <div className="p-8">No agent found</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Agent Profile</h1>
        <p className="text-muted-foreground">Economic identity and credit standing</p>
      </div>

      {/* Identity banner */}
      <div className="border border-border rounded-lg p-6">
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="relative size-24 shrink-0 overflow-hidden rounded-xl border border-border">
            <Image src="/agent-atlas.png" alt={`${agent.name} emblem`} fill className="object-cover" />
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold">{agent.name}</h2>
            <p className="text-sm text-muted-foreground mt-1">{agent.description}</p>
            <div className="grid grid-cols-3 gap-4 mt-4">
              <div>
                <p className="text-2xl font-bold">{Math.round(parseFloat(agent.creditScore))}</p>
                <p className="text-xs text-muted-foreground">Credit Score</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{agent.riskRating}</p>
                <p className="text-xs text-muted-foreground">Risk Rating</p>
              </div>
              <div>
                <p className="text-2xl font-bold">${Math.round(parseFloat(agent.availableCredit || 0) / 1000)}K</p>
                <p className="text-xs text-muted-foreground">Available Credit</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Identity Details */}
        <div className="border border-border rounded-lg p-6">
          <h3 className="font-bold text-lg mb-4">Identity</h3>
          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Wallet className="size-4" />
                Wallet Address
              </span>
              <span className="font-mono text-xs break-all text-right max-w-xs">{agent.walletAddress}</span>
            </div>
            <div className="flex items-start justify-between">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarDays className="size-4" />
                Created
              </span>
              <span className="text-sm">{new Date(agent.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="flex items-start justify-between">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="size-4" />
                Status
              </span>
              <span className="text-sm font-medium text-success">Verified</span>
            </div>
            <div className="flex items-start justify-between">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Cpu className="size-4" />
                Type
              </span>
              <span className="text-sm">AI Agent</span>
            </div>
          </div>
        </div>

        {/* Credit Information */}
        <div className="border border-border rounded-lg p-6">
          <h3 className="font-bold text-lg mb-4">Credit Information</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total Credit Line</span>
              <span className="font-mono font-bold">${Math.round(parseFloat(agent.totalCreditLine || 0)).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Used</span>
              <span className="font-mono font-bold">${Math.round(parseFloat(agent.usedCredit || 0)).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Available</span>
              <span className="font-mono font-bold text-success">${Math.round(parseFloat(agent.availableCredit || 0)).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-border">
              <span className="text-sm text-muted-foreground">Interest Rate</span>
              <span className="font-mono font-bold">8.5% APR</span>
            </div>
          </div>
        </div>
      </div>

      {/* Attestations */}
      <div className="border border-border rounded-lg p-6">
        <h3 className="font-bold text-lg mb-4">On-Chain Attestations</h3>
        <p className="text-sm text-muted-foreground">Verifiable credentials from third parties</p>
        <div className="mt-4 space-y-2">
          {agent.attestations && agent.attestations.length > 0 ? (
            agent.attestations.map((att: any, i: number) => (
              <div key={i} className="p-3 bg-secondary/50 rounded text-sm">
                {att}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No attestations yet</p>
          )}
        </div>
      </div>
    </div>
  )
}
