'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { DashboardShell } from '@/components/dashboard-shell'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkSession = async () => {
      try {
        const session = await authClient.getSession()
        if (!session?.user) {
          router.push('/sign-in')
          return
        }
        setLoading(false)
      } catch (error) {
        console.error('[v0] Session check error:', error)
        router.push('/sign-in')
      }
    }

    checkSession()
  }, [router])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return <DashboardShell>{children}</DashboardShell>
}
