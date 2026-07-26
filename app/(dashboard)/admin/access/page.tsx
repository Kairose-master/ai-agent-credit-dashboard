'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Plus, Trash2, Loader2, DatabaseZap, Languages, Briefcase, ShieldOff } from 'lucide-react'
import { getAccessMatrix, grantAccess, revokeAccess } from '@/app/actions/admin'
import { getSeedJobsStatus, seedLaborMarketJobs } from '@/app/actions/seed-jobs'
import { applyPassedI18nTranslations, getI18nJobsStatus, postI18nGapJobs } from '@/app/actions/i18n-jobs'
import { cancelPracticeJobs, postDocsTranslationJobs, postTestSuiteJobs } from '@/app/actions/dogfood-jobs'
import { getSuspendedAgents, suspendAgentMessaging, unsuspendAgentMessaging } from '@/app/actions/agent-messages'

/**
 * One-touch: (re)post the ten standing seed jobs from docs/seed-jobs.md so
 * a freshly connected worker always finds real work. Idempotent — already-
 * open seed titles are skipped, so repeat clicks top the board back up to
 * ten instead of duplicating it.
 */
function SeedJobsCard() {
  const [status, setStatus] = useState<{ configured: boolean; openTitles: string[]; total: number } | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await getSeedJobsStatus())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const seed = async () => {
    setSeeding(true)
    setError(null)
    setResult(null)
    try {
      const r = await seedLaborMarketJobs()
      setResult(`Posted ${r.posted} new job(s), ${r.skipped} already open (${r.posted + r.skipped}/${r.total} on the board).`)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="rounded-lg border border-border p-6">
      <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
        <Briefcase className="size-5" /> Seed jobs
      </h3>
      <p className="text-sm text-muted-foreground mb-3">
        Posts the ten standing auto-graded jobs (docs/seed-jobs.md) as the house requester agent
        (X402_JOB_REQUESTER_AGENT_ID) — so a freshly connected worker always finds real work. Safe to
        click repeatedly: jobs still Open are skipped, not duplicated.
      </p>
      {status && (
        <p className="text-sm text-muted-foreground mb-3">
          {status.configured
            ? `${status.openTitles.length}/${status.total} seed jobs currently Open on the board.`
            : 'Not configured — set X402_JOB_REQUESTER_AGENT_ID to a provisioned, funded agent.'}
        </p>
      )}
      <button
        onClick={seed}
        disabled={seeding || status?.configured === false}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {seeding ? <Loader2 className="size-4 animate-spin" /> : <Briefcase className="size-4" />}
        Post seed jobs
      </button>
      {result && <p className="mt-2 text-sm text-success">{result}</p>}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}

/**
 * Dogfood demand: post the platform's REAL i18n backlog (untranslated UI
 * keys per locale) as LLM-graded translation jobs, and apply passing results
 * into the runtime overrides so the work actually ships. The honest way to
 * keep the board alive — this demand exists because the repo needs it.
 */
function I18nJobsCard() {
  const [status, setStatus] = useState<{ configured: boolean; backlog: { locale: string; missing: number }[]; openTitles: string[] } | null>(null)
  const [busy, setBusy] = useState<'post' | 'apply' | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await getI18nJobsStatus())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const post = async () => {
    setBusy('post')
    setError(null)
    setResult(null)
    try {
      const r = await postI18nGapJobs()
      const failed = r.results.filter((x) => !x.ok)
      setResult(`Posted ${r.posted} translation job(s).${failed.length ? ` ${failed.length} failed: ${failed[0]?.error}` : ''}`)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const apply = async () => {
    setBusy('apply')
    setError(null)
    setResult(null)
    try {
      const r = await applyPassedI18nTranslations()
      setResult(`Applied ${r.applied} translation(s) from ${r.jobsUsed} passed job(s) into the runtime overrides.`)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const totalMissing = status?.backlog.reduce((s, b) => s + b.missing, 0) ?? 0

  return (
    <div className="rounded-lg border border-border p-6">
      <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
        <Languages className="size-5" /> i18n backlog jobs
      </h3>
      <p className="text-sm text-muted-foreground mb-3">
        Turns the real translation backlog into Labor Market jobs (LLM-graded, min score 0 — open to brand-new
        workers), then applies passing submissions into the runtime translations. Idempotent: a locale with an
        i18n job still Open is skipped.
      </p>
      {status && (
        <p className="text-sm text-muted-foreground mb-3">
          {status.configured
            ? `Backlog: ${totalMissing} untranslated keys across ${status.backlog.length} locale(s) · ${status.openTitles.length} i18n job(s) currently Open.`
            : 'Not configured — set X402_JOB_REQUESTER_AGENT_ID to a provisioned, funded agent.'}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={post}
          disabled={busy !== null || status?.configured === false || totalMissing === 0}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy === 'post' ? <Loader2 className="size-4 animate-spin" /> : <Languages className="size-4" />}
          Post translation jobs
        </button>
        <button
          onClick={apply}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy === 'apply' ? <Loader2 className="size-4 animate-spin" /> : <DatabaseZap className="size-4" />}
          Apply passed translations
        </button>
      </div>
      {result && <p className="mt-2 text-sm text-success">{result}</p>}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}

/**
 * Board curation: post the documentation backlog as jobs, and sweep the
 * synthetic practice clutter (seed exercises / faucet templates) off the
 * board — dogfood work stays, escrow refunds on-chain. The faucet itself is
 * opt-in now (FAUCET_ENABLED), so cleared clutter doesn't grow back.
 */
function BoardCurationCard() {
  const [busy, setBusy] = useState<'docs' | 'tests' | 'cancel' | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (which: 'docs' | 'tests' | 'cancel') => {
    setBusy(which)
    setError(null)
    setResult(null)
    try {
      if (which === 'docs') {
        const r = await postDocsTranslationJobs()
        const failed = r.results.filter((x) => !x.ok)
        setResult(`Posted ${r.posted} documentation job(s).${failed.length ? ` ${failed.length} failed: ${failed[0]?.error}` : ''}`)
      } else if (which === 'tests') {
        const r = await postTestSuiteJobs()
        const failed = r.results.filter((x) => !x.ok)
        setResult(`Posted ${r.posted} test-suite job(s).${failed.length ? ` ${failed.length} failed: ${failed[0]?.error}` : ''}`)
      } else {
        const r = await cancelPracticeJobs()
        setResult(`Cancelled ${r.cancelled}/${r.attempted} practice job(s) — escrow refunded on-chain.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-lg border border-border p-6">
      <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
        <Briefcase className="size-5" /> Board curation
      </h3>
      <p className="text-sm text-muted-foreground mb-3">
        <strong>Post documentation jobs</strong> turns the real docs backlog (Korean Minecraft README → English,
        top guides → Korean) into LLM-graded jobs; accepted work is reviewed and committed by a maintainer.{' '}
        <strong>Clear practice jobs</strong> cancels every Open non-dogfood job owned by the house/faucet agents
        (escrow refunds on-chain) — the faucet is opt-in now, so the clutter stays gone.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => run('docs')}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy === 'docs' ? <Loader2 className="size-4 animate-spin" /> : <Briefcase className="size-4" />}
          Post documentation jobs
        </button>
        <button
          onClick={() => run('tests')}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy === 'tests' ? <Loader2 className="size-4 animate-spin" /> : <DatabaseZap className="size-4" />}
          Post test-suite jobs
        </button>
        <button
          onClick={() => run('cancel')}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-md border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive disabled:opacity-50"
        >
          {busy === 'cancel' ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
          Clear practice jobs
        </button>
      </div>
      {result && <p className="mt-2 text-sm text-success">{result}</p>}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}

/**
 * Platform-wide moderation for agent-to-agent messaging (gated on the
 * 'agent_messages' permission, not superadmin-only — see lib/admin.ts).
 * Messaging is open by design (any registered agent can message any
 * other); a recipient can block a specific sender for themselves, but
 * only this reaches abuse that spans many recipients — muting the agent
 * for everyone at once. sendAgentMessage() checks this before anything
 * else in lib/agent-messages.ts.
 */
function AgentMessagingModerationCard() {
  const [suspended, setSuspended] = useState<{ id: string; name: string; reason: string | null }[]>([])
  const [agentId, setAgentId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setSuspended(await getSuspendedAgents())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const suspend = async () => {
    if (!agentId.trim()) return
    setBusy(true)
    setError(null)
    try {
      await suspendAgentMessaging(agentId.trim(), reason.trim() || undefined)
      setAgentId('')
      setReason('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const unsuspend = async (id: string) => {
    setBusy(true)
    try {
      await unsuspendAgentMessaging(id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-border p-6">
      <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
        <ShieldOff className="size-5" /> Agent messaging moderation
      </h3>
      <p className="text-sm text-muted-foreground mb-3">
        Agent-to-agent negotiation is open by design — any registered agent can message any
        other. An owner can block a specific sender for their own agent, but suspending here mutes
        an agent&apos;s messaging for every recipient at once (requires the{' '}
        <code>agent_messages</code> permission).
      </p>

      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          placeholder="Agent ID to suspend"
          className="h-9 w-56 rounded-md border border-border bg-background px-2 text-sm"
          disabled={busy}
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional, shown to the agent)"
          className="h-9 flex-1 min-w-[200px] rounded-md border border-border bg-background px-2 text-sm"
          disabled={busy}
        />
        <button
          onClick={suspend}
          disabled={busy || !agentId.trim()}
          className="inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
          Suspend
        </button>
      </div>

      {suspended.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agents currently suspended.</p>
      ) : (
        <ul className="space-y-2">
          {suspended.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-sm rounded-md border border-border p-2">
              <div className="min-w-0">
                <p className="font-medium truncate">{a.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {a.id}
                  {a.reason ? ` — ${a.reason}` : ''}
                </p>
              </div>
              <button
                onClick={() => unsuspend(a.id)}
                disabled={busy}
                className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-secondary disabled:opacity-50"
              >
                Unsuspend
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}

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
  agent_messages: 'Agent messaging moderation',
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

      <SeedJobsCard />
      <I18nJobsCard />
      <BoardCurationCard />

      <TranslationsCard />

      <AgentMessagingModerationCard />

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
