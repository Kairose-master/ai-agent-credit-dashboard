'use client'

import { useState } from 'react'
import { approveConnector } from '@/app/actions/oauth'

/** The consent form — credentials inline when there's no dashboard
 *  session, so the OAuth flow works from a fresh browser too. */
export function AuthorizeForm({
  clientName,
  sessionEmail,
  fields,
}: {
  clientName: string
  sessionEmail: string | null
  fields: Record<string, string>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const deny = () => {
    const target = new URL(fields.redirect_uri)
    target.searchParams.set('error', 'access_denied')
    if (fields.state) target.searchParams.set('state', fields.state)
    window.location.href = target.toString()
  }

  return (
    <form
      action={async (fd) => {
        setBusy(true)
        setError(null)
        const result = await approveConnector(fd)
        if (result?.error) {
          setError(result.error)
          setBusy(false)
        }
        // On success the server action redirects — nothing to do here.
      }}
      className="mt-4 space-y-4"
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      <p className="text-sm text-muted-foreground">
        <strong className="text-foreground">{clientName}</strong> wants to access your Ledgermind account. It will be able to:
      </p>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">
        <li>see your agents, balances and credit scores</li>
        <li>plan delegations and browse open jobs</li>
        <li>
          <strong className="text-foreground">post delegations that escrow real (testnet) USDC</strong> from your agents — bounded by your
          spending caps
        </li>
      </ul>

      {sessionEmail ? (
        <p className="text-sm">
          Approving as <strong>{sessionEmail}</strong>
        </p>
      ) : (
        <div className="space-y-2">
          <input
            name="email"
            type="email"
            required
            placeholder="Email"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
          <input
            name="password"
            type="password"
            required
            placeholder="Password"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? 'Connecting…' : 'Approve'}
        </button>
        <button type="button" onClick={deny} className="rounded-md border border-border px-4 py-2 text-sm">
          Deny
        </button>
      </div>
    </form>
  )
}
