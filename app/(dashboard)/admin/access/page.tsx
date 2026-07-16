'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Plus, Trash2, Loader2, DatabaseZap, Languages } from 'lucide-react'
import { getAccessMatrix, grantAccess, revokeAccess } from '@/app/actions/admin'

type I18nStatus = {
  totalKeys: number
  locales: { value: string; label: string; runtime: boolean; missing: number }[]
  keySource: 'byok' | 'platform' | null
}

/**
 * Runtime translations: fill dictionary gaps (and add whole locales) from
 * the browser, powered by the admin's registered API key — no repo commit,
 * no redeploy. Each click drives a batch loop against /api/admin/i18n so a
 * big dictionary never outruns the serverless time limit.
 */
function TranslationsCard() {
  const [status, setStatus] = useState<I18nStatus | null>(null)
  const [working, setWorking] = useState<string | null>(null) // locale being translated
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [newCode, setNewCode] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const refresh = useCallback(async () => {
    const res = await fetch('/api/admin/i18n')
    if (res.ok) setStatus(await res.json())
  }, [])

  useEffect(() => {
    refresh().catch(() => {})
  }, [refresh])

  const translate = async (locale: string) => {
    setWorking(locale)
    setError(null)
    setProgress('')
    try {
      let done = 0
      for (;;) {
        const res = await fetch('/api/admin/i18n', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'translate', locale }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'Translation failed')
        done += body.translated
        setProgress(`${locale}: ${done} translated, ${body.remaining} to go`)
        if (body.remaining === 0) break
      }
      setProgress(`${locale}: done — live for all visitors now`)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(null)
    }
  }

  const addLocale = async () => {
    setError(null)
    const res = await fetch('/api/admin/i18n', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'addLocale', code: newCode, label: newLabel }),
    })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? 'Failed to add locale')
      return
    }
    setNewCode('')
    setNewLabel('')
    await refresh()
    await translate(body.code)
  }

  return (
    <div className="rounded-lg border border-border p-6">
      <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
        <Languages className="size-5" /> Runtime translations
      </h3>
      <p className="text-sm text-muted-foreground mb-3">
        LLM-translates missing UI strings into the database — no commit, no redeploy. Uses{' '}
        {status?.keySource === 'byok'
          ? 'your registered API key (Settings)'
          : status?.keySource === 'platform'
            ? "the platform's ANTHROPIC_API_KEY"
            : 'an API key — none found: register yours in Settings or set ANTHROPIC_API_KEY'}
        . Shipped dictionaries always win over these.
      </p>

      {status && (
        <div className="space-y-2">
          {status.locales.map((l) => (
            <div key={l.value} className="flex items-center gap-3 text-sm">
              <span className="w-28 font-mono">
                {l.value} · {l.label}
              </span>
              <span className={l.missing === 0 ? 'text-success' : 'text-muted-foreground'}>
                {l.missing === 0 ? 'complete' : `${l.missing}/${status.totalKeys} missing`}
              </span>
              {l.runtime && <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">runtime</span>}
              {l.missing > 0 && (
                <button
                  onClick={() => translate(l.value)}
                  disabled={working !== null || status.keySource === null}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  {working === l.value ? <Loader2 className="size-3 animate-spin" /> : <Languages className="size-3" />}
                  Translate
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          placeholder="locale code (ja)"
          className="w-36 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        />
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="native name (日本語)"
          className="w-40 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        />
        <button
          onClick={addLocale}
          disabled={working !== null || !newCode || !newLabel || status?.keySource === null}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          <Plus className="size-3.5" /> Add language
        </button>
      </div>

      {progress && <p className="mt-2 text-sm text-success">{progress}</p>}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}

type Grant = { userId: string; email: string; permission: string; grantedAt: string | Date }

const PERMISSION_LABEL: Record<string, string> = {
  disputes: 'Dispute review',
  credit_rules: 'Credit rating policy',
}

export default function AccessControlPage() {
  const [permissions, setPermissions] = useState<string[]>([])
  const [grants, setGrants] = useState<Grant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [permission, setPermission] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const data = await getAccessMatrix()
    setPermissions(data.permissions)
    setGrants(data.grants as Grant[])
    if (!permission && data.permissions.length > 0) setPermission(data.permissions[0])
  }, [permission])

  useEffect(() => {
    refresh()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grant = async () => {
    setBusy(true)
    setError(null)
    try {
      await grantAccess(email, permission as never)
      setEmail('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (userId: string, perm: string) => {
    setBusy(true)
    try {
      await revokeAccess(userId, perm as never)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const [migrating, setMigrating] = useState(false)
  const [migrateResult, setMigrateResult] = useState<string | null>(null)

  const runMigration = async () => {
    setMigrating(true)
    setMigrateResult(null)
    try {
      const res = await fetch('/api/admin/migrate', { method: 'POST' })
      const body = await res.json()
      setMigrateResult(res.ok ? 'Migration complete.' : `Failed: ${body.error}`)
    } catch (e) {
      setMigrateResult(`Failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setMigrating(false)
    }
  }

  if (loading) return <div className="p-8">Loading…</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <KeyRound className="size-7" /> Access Control
        </h1>
        <p className="text-muted-foreground mt-1">
          The access control matrix — which accounts hold which admin permission. Superadmin
          (ADMIN_EMAIL) implicitly holds every permission and isn&apos;t listed here.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-border p-6">
        <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
          <DatabaseZap className="size-5" /> Database migration
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          Runs the same idempotent schema migration as <code>pnpm db:migrate</code>, but against
          this server&apos;s own DB connection — no ambiguity about which database gets it.
        </p>
        <button
          onClick={runMigration}
          disabled={migrating}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {migrating ? <Loader2 className="size-4 animate-spin" /> : <DatabaseZap className="size-4" />}
          Run migration
        </button>
        {migrateResult && (
          <p className={`mt-2 text-sm ${migrateResult.startsWith('Failed') ? 'text-destructive' : 'text-success'}`}>
            {migrateResult}
          </p>
        )}
      </div>

      <TranslationsCard />

      <div className="rounded-lg border border-border p-6">
        <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
          <Plus className="size-5" /> Grant a permission
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@email.com"
            className="h-9 w-64 rounded-md border border-border bg-background px-3 text-sm"
            disabled={busy}
          />
          <select
            value={permission}
            onChange={(e) => setPermission(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            disabled={busy}
          >
            {permissions.map((p) => (
              <option key={p} value={p}>
                {PERMISSION_LABEL[p] ?? p}
              </option>
            ))}
          </select>
          <button
            onClick={grant}
            disabled={busy || !email.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Grant
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40">
            <tr>
              <th className="text-left font-medium p-3">Account</th>
              <th className="text-left font-medium p-3">Permission</th>
              <th className="text-left font-medium p-3">Granted</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {grants.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-4 text-center text-muted-foreground">
                  No permissions granted yet.
                </td>
              </tr>
            ) : (
              grants.map((g) => (
                <tr key={`${g.userId}-${g.permission}`} className="border-t border-border">
                  <td className="p-3">{g.email}</td>
                  <td className="p-3">{PERMISSION_LABEL[g.permission] ?? g.permission}</td>
                  <td className="p-3 text-muted-foreground">{new Date(g.grantedAt).toLocaleString()}</td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => revoke(g.userId, g.permission)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded bg-destructive/15 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/25 disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" /> Revoke
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
