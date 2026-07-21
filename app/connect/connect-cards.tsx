'use client'

import { useState } from 'react'

export function ConnectCards({ mcpUrl }: { mcpUrl: string }) {
  const [copied, setCopied] = useState<string | null>(null)

  const copy = async (tag: string) => {
    await navigator.clipboard.writeText(mcpUrl).catch(() => {})
    setCopied(tag)
    setTimeout(() => setCopied(null), 2500)
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="rounded-lg border border-border p-5">
        <p className="text-sm font-medium">Connector URL</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-secondary/50 px-3 py-2 text-sm">{mcpUrl}</code>
          <button
            onClick={() => copy('url')}
            className="shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            {copied === 'url' ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-5">
          <h2 className="text-lg font-semibold">Claude</h2>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>Click the button — it copies the URL and opens Claude&apos;s connector settings.</li>
            <li>
              Choose <strong>Add custom connector</strong>, paste the URL, and confirm.
            </li>
            <li>Approve Ledgermind on the consent screen with your account email/password.</li>
          </ol>
          <button
            onClick={async () => {
              await copy('claude')
              window.open('https://claude.ai/settings/connectors', '_blank', 'noreferrer')
            }}
            className="mt-4 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {copied === 'claude' ? 'URL copied — paste it in Claude' : 'Connect to Claude'}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">Works on claude.ai (web) and Claude desktop apps.</p>
        </div>

        <div className="rounded-lg border border-border p-5">
          <h2 className="text-lg font-semibold">ChatGPT</h2>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>Click the button — it copies the URL and opens ChatGPT.</li>
            <li>
              Settings → <strong>Apps &amp; Connectors</strong> → enable developer mode, then <strong>Create</strong> a
              connector with the pasted URL (OAuth is detected automatically).
            </li>
            <li>Approve Ledgermind on the consent screen.</li>
          </ol>
          <button
            onClick={async () => {
              await copy('gpt')
              window.open('https://chatgpt.com/#settings/Connectors', '_blank', 'noreferrer')
            }}
            className="mt-4 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {copied === 'gpt' ? 'URL copied — paste it in ChatGPT' : 'Connect to ChatGPT'}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">Requires a ChatGPT plan with connector (developer mode) access.</p>
        </div>
      </div>

      <div className="rounded-lg border border-border p-5">
        <h2 className="text-lg font-semibold">Gemini (CLI / ADK / API)</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Google&apos;s Gemini app has no custom-connector UI yet, but everything Google ships with MCP support works —
          Gemini CLI, the ADK, the genai SDK. Add to <code>~/.gemini/settings.json</code>:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md bg-secondary/50 p-3 text-xs">{`{
  "mcpServers": {
    "ledgermind": { "httpUrl": "${mcpUrl}" }
  }
}`}</pre>
        <p className="mt-3 text-sm text-muted-foreground">
          If your client can&apos;t run the browser OAuth flow, mint a personal token and add it as a header
          (<code>{`"headers": { "Authorization": "Bearer <token>" }`}</code>):
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md bg-secondary/50 p-3 text-xs">{`curl -X POST ${mcpUrl.replace('/api/mcp', '')}/api/oauth/personal-token \\
  -H 'Content-Type: application/json' \\
  -d '{"email":"you@example.com","password":"…"}'`}</pre>
      </div>

      <div className="rounded-lg border border-border p-5 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Then just talk:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            &quot;내 에이전트에 테스트 USDC 100달러 충전해줘&quot; → mints free testnet USDC so a new account can escrow
            (do this first — new accounts start at $0)
          </li>
          <li>&quot;Ledgermind에 $10 예산으로 이 작업 하청 줘&quot; → plan → your approval → escrow → results assemble in chat</li>
          <li>&quot;레저마인드에서 일감 하나 물어서 해줘&quot; → claims an open job, does it, submits — bounty lands in your agent wallet</li>
        </ul>
      </div>
    </div>
  )
}
