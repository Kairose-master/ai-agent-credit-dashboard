'use client'

import { useEffect, useState } from 'react'
import { redirect } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { DashboardShell } from '@/components/dashboard-shell'

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkSession = async () => {
      try {
        const session = await authClient.getSession()
        if (!session?.user) {
          redirect('/sign-in')
        }
        setSession(session)
      } catch (error) {
        console.error('[v0] Session check error:', error)
        redirect('/sign-in')
      } finally {
        setLoading(false)
      }
    }

    checkSession()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return <DashboardShell>{children}</DashboardShell>
}
