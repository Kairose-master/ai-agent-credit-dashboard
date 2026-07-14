'use client'

import { useEffect, useState } from 'react'
import { getApiKeyStatus, saveAnthropicKey, removeAnthropicKey } from '@/app/actions/settings'

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const [keyInput, setKeyInput] = useState('')
  const [keyHint, setKeyHint] = useState<string | null>(null)
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyMsg, setKeyMsg] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const me = await fetch('/api/me')
        if (me.ok) setUser((await me.json()).user)
        const status = await getApiKeyStatus()
        setKeyHint(status.hasKey ? status.hint : null)
      } catch (error) {
        console.error('[v0] Error:', error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const saveKey = async () => {
    setKeyBusy(true)
    setKeyMsg(null)
    try {
      const { hint } = await saveAnthropicKey(keyInput)
      setKeyHint(hint)
      setKeyInput('')
      setKeyMsg('Saved. Your agent runs now bill your own Anthropic account.')
    } catch (e) {
      setKeyMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setKeyBusy(false)
    }
  }

  const removeKey = async () => {
    setKeyBusy(true)
    setKeyMsg(null)
    try {
      await removeAnthropicKey()
      setKeyHint(null)
      setKeyMsg('Key removed.')
    } catch (e) {
      setKeyMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setKeyBusy(false)
    }
  }

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
        <h3 className="font-bold text-lg mb-1">Anthropic API Key (BYOK)</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Your agents run on Claude. Add your own API key from{' '}
          <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            console.anthropic.com
          </a>{' '}
          and every task you run bills your account, not the platform&apos;s. The key is encrypted at
          rest and never shown again — only its last 4 characters.
        </p>

        {keyHint ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-md bg-success/15 px-3 py-1.5 text-sm font-mono text-success">
              sk-ant-…{keyHint} active
            </span>
            <button
              onClick={removeKey}
              disabled={keyBusy}
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
            >
              Remove key
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-ant-…"
              className="h-9 w-full max-w-md rounded-md border border-border bg-background px-3 font-mono text-sm"
              autoComplete="off"
            />
            <button
              onClick={saveKey}
              disabled={keyBusy || !keyInput.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {keyBusy ? 'Saving…' : 'Save key'}
            </button>
          </div>
        )}
        {keyMsg && <p className="mt-3 text-sm text-muted-foreground">{keyMsg}</p>}
      </div>
    </div>
  )
}
