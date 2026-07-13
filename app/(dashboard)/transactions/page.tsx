'use client'

import { useEffect, useState } from 'react'
import { getTransactions, approveTransaction, rejectTransaction } from '@/app/actions/transactions'

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getTransactions()
        setTransactions(data)
      } catch (error) {
        console.error('[v0] Error:', error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleApprove = async (txId: string) => {
    try {
      await approveTransaction(txId)
      setTransactions(transactions.map(t => t.id === txId ? { ...t, status: 'approved' } : t))
    } catch (error) {
      console.error('[v0] Error approving:', error)
    }
  }

  const handleReject = async (txId: string) => {
    try {
      await rejectTransaction(txId)
      setTransactions(transactions.map(t => t.id === txId ? { ...t, status: 'rejected' } : t))
    } catch (error) {
      console.error('[v0] Error rejecting:', error)
    }
  }

  if (loading) return <div className="p-8">Loading transactions...</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Credit Transactions</h1>
        <p className="text-muted-foreground">Agent-to-agent credit requests and settlements</p>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Amount</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Description</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-secondary/30">
                  <td className="px-4 py-3">{tx.type}</td>
                  <td className="px-4 py-3 font-mono font-bold">${Math.round(parseFloat(tx.amount)).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium ${
                      tx.status === 'approved' ? 'bg-success/15 text-success' :
                      tx.status === 'rejected' ? 'bg-destructive/15 text-destructive' :
                      tx.status === 'settled' ? 'bg-primary/15 text-primary' :
                      'bg-warning/15 text-warning'
                    }`}>
                      {tx.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{tx.description}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {tx.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleApprove(tx.id)}
                          className="text-xs px-2 py-1 rounded bg-success/15 text-success hover:bg-success/25"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleReject(tx.id)}
                          className="text-xs px-2 py-1 rounded bg-destructive/15 text-destructive hover:bg-destructive/25"
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
