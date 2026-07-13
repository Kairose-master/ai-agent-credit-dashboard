'use client'

import { useEffect, useState } from 'react'

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const me = await fetch('/api/me')
        if (me.ok) setUser((await me.json()).user)
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
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Account and platform preferences</p>
      </div>

      <div className="border border-border rounded-lg p-6">
        <h3 className="font-bold text-lg mb-4">Account Information</h3>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Name</p>
            <p className="font-medium">{user?.name || 'Not set'}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Email</p>
            <p className="font-mono text-sm">{user?.email}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Account Status</p>
            <p className="inline-flex items-center px-3 py-1 rounded-md bg-success/15 text-success text-sm font-medium">
              Active
            </p>
          </div>
        </div>
      </div>

      <div className="border border-border rounded-lg p-6">
        <h3 className="font-bold text-lg mb-4">Platform Settings</h3>
        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <input type="checkbox" className="w-4 h-4" defaultChecked />
            <span className="text-sm">Email notifications for new credit requests</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" className="w-4 h-4" defaultChecked />
            <span className="text-sm">Risk alerts for portfolio changes</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" className="w-4 h-4" />
            <span className="text-sm">Marketing emails</span>
          </label>
        </div>
      </div>

      <div className="border border-border rounded-lg p-6">
        <h3 className="font-bold text-lg mb-4">API Keys</h3>
        <p className="text-sm text-muted-foreground mb-4">Manage API keys for programmatic access</p>
        <button className="px-4 py-2 rounded border border-border hover:bg-secondary text-sm">
          Generate new API key
        </button>
      </div>
    </div>
  )
}
