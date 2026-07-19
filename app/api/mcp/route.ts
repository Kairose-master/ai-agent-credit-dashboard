import { db } from '@/lib/db'
import { agent, delegation } from '@/lib/db/schema'
import { desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { after } from 'next/server'
import { resolveMcpAuth, unauthorizedMcp, requestOrigin, type McpAuth } from '@/lib/oauth'
import {
  planDelegation,
  postDelegationJobs,
  tickDelegation,
  subtaskViews,
  type DelegationSubtask,
} from '@/lib/delegation'

export const maxDuration = 120

const MAX_BUDGET_USD = 500 // keep in sync with app/actions/delegate.ts

/**
 * MCP server (Streamable HTTP, stateless JSON responses) — the connector
 * surface for Claude / ChatGPT. OAuth-protected: no token → 401 with a
 * WWW-Authenticate pointer, which is what triggers the connector's OAuth
 * flow. Tools mirror the delegation API: nothing here can move money in
 * one step — plan first (free), confirm second (escrows, capped).
 */
export async function POST(request: Request) {
  const origin = requestOrigin(request)
  const auth = await resolveMcpAuth(request)
  if (!auth) return unauthorizedMcp(origin)

  const msg = await request.json().catch(() => null)
  if (!msg || typeof msg.method !== 'string') {
    return rpcError(null, -32700, 'Parse error')
  }

  // Notifications (no id) get a bare 202 per the Streamable HTTP transport.
  if (msg.id === undefined || msg.id === null) {
    return new Response(null, { status: 202 })
  }

  try {
    switch (msg.method) {
      case 'initialize':
        return rpcResult(msg.id, {
          protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'ledgermind', version: '1.0.0' },
          instructions:
            'Ledgermind is an AI-agent labor market with on-chain (testnet USDC) escrow. ' +
            'Use plan_delegation to decompose a goal into priced subtasks (free), review the plan, ' +
            'then confirm_delegation to escrow bounties and post the work. delegation_status tracks ' +
            'progress and returns the assembled final output when done.',
        })
      case 'ping':
        return rpcResult(msg.id, {})
      case 'tools/list':
        return rpcResult(msg.id, { tools: TOOLS })
      case 'tools/call':
        return await callTool(msg.id, auth, String(msg.params?.name ?? ''), msg.params?.arguments ?? {})
      default:
        return rpcError(msg.id, -32601, `Method not found: ${msg.method}`)
    }
  } catch (error) {
    console.error('[mcp]', error)
    return rpcError(msg.id, -32603, error instanceof Error ? error.message : String(error))
  }
}

// The transport also allows GET (SSE stream) — we're stateless, so decline
// politely; clients fall back to plain POST request/response.
export async function GET() {
  return new Response(null, { status: 405 })
}
export async function DELETE() {
  return new Response(null, { status: 200 })
}

function rpcResult(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: '2.0', id, result })
}
function rpcError(id: unknown, code: number, message: string) {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } })
}
function toolText(id: unknown, text: string, isError = false) {
  return rpcResult(id, { content: [{ type: 'text', text }], isError })
}

const TOOLS = [
  {
    name: 'list_my_agents',
    description:
      'List the agents on your Ledgermind account with their credit scores, on-chain addresses and USDC balances. ' +
      'Agents both earn (as workers) and pay (as delegation primes).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'plan_delegation',
    description:
      'Decompose a goal into priced subtasks using the platform planner. FREE — nothing is escrowed or posted. ' +
      'Returns a delegation_id and the exact plan; show the plan to the user and only call confirm_delegation ' +
      'after they approve it.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'What needs to be done (min 20 chars)' },
        budget_usd: { type: 'number', description: `Total budget in USDC (2–${MAX_BUDGET_USD})` },
        prime_agent_name: {
          type: 'string',
          description: 'Which of your agents escrows the bounties (optional — defaults to your first funded agent)',
        },
      },
      required: ['goal', 'budget_usd'],
      additionalProperties: false,
    },
  },
  {
    name: 'confirm_delegation',
    description:
      'MOVES MONEY: posts a previously planned delegation as real escrowed jobs (testnet USDC, bounded by the ' +
      'account spending caps). Only call after the user has seen and approved the exact plan from plan_delegation.',
    inputSchema: {
      type: 'object',
      properties: { delegation_id: { type: 'string' } },
      required: ['delegation_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'delegation_status',
    description:
      'Your delegations with live per-subtask job status, and the assembled final output once completed. ' +
      'Polling this also drives verification/payout of submitted work.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'browse_open_jobs',
    description: 'Open jobs on the labor market right now (bounty, title, requirements) — work your agents could claim.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

async function callTool(id: unknown, auth: McpAuth, name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'list_my_agents': {
      const agents = await db.select().from(agent).where(eq(agent.userId, auth.userId))
      if (agents.length === 0) return toolText(id, 'No agents yet — create one on the dashboard or via the desktop Miner.')
      const { usdcBalanceOf } = await import('@/lib/onchain/treasury')
      const lines: string[] = []
      for (const a of agents) {
        let bal = 'unprovisioned'
        if (a.smartAccountAddress) {
          bal = await usdcBalanceOf(a.smartAccountAddress as `0x${string}`)
            .then((b) => `$${b.toFixed(2)} USDC`)
            .catch(() => 'balance unavailable')
        }
        lines.push(`- ${a.name} · credit ${a.creditScore ?? '?'} · ${bal} · ${a.smartAccountAddress ?? 'no wallet'}`)
      }
      return toolText(id, lines.join('\n'))
    }

    case 'plan_delegation': {
      const goal = String(args.goal ?? '').trim()
      const budgetUsd = Number(args.budget_usd)
      if (goal.length < 20) return toolText(id, 'Describe the goal in at least 20 characters.', true)
      if (!Number.isFinite(budgetUsd) || budgetUsd < 2 || budgetUsd > MAX_BUDGET_USD) {
        return toolText(id, `budget_usd must be between 2 and ${MAX_BUDGET_USD}.`, true)
      }
      const agents = await db.select().from(agent).where(eq(agent.userId, auth.userId))
      const wanted = args.prime_agent_name ? String(args.prime_agent_name) : null
      const prime = wanted
        ? agents.find((a) => a.name.toLowerCase() === wanted.toLowerCase())
        : agents.find((a) => a.smartAccountAddress)
      if (!prime) return toolText(id, wanted ? `No agent named "${wanted}" on this account.` : 'No provisioned agent found.', true)
      if (!prime.smartAccountAddress) return toolText(id, `Agent ${prime.name} has no wallet yet — provision it first.`, true)

      const subtasks = await planDelegation(auth.userId, goal, budgetUsd)
      const dlgId = `dlg-${nanoid(10)}`
      await db.insert(delegation).values({
        id: dlgId,
        userId: auth.userId,
        primeAgentId: prime.id,
        task: goal,
        budgetUsd: budgetUsd.toFixed(2),
        status: 'planned',
        subtasks,
        autoVerify: true,
      })
      const planText = subtasks
        .map((st, i) => `${i + 1}. [$${st.bountyUsd.toFixed(2)}] ${st.title}\n   ${st.description}\n   Accept when: ${st.acceptanceCriteria}`)
        .join('\n')
      return toolText(
        id,
        `Plan ready (delegation_id: ${dlgId}, prime agent: ${prime.name}, total $${budgetUsd.toFixed(2)}):\n\n${planText}\n\n` +
          `Nothing is escrowed yet. Show this plan to the user; call confirm_delegation only after they approve.`,
      )
    }

    case 'confirm_delegation': {
      const dlgId = String(args.delegation_id ?? '')
      const [row] = await db.select().from(delegation).where(eq(delegation.id, dlgId))
      if (!row || row.userId !== auth.userId) return toolText(id, 'Delegation not found on this account.', true)
      if (row.status !== 'planned') return toolText(id, `Delegation is already ${row.status}.`, true)
      try {
        const subtasks = await postDelegationJobs(row.primeAgentId, Number(row.budgetUsd), row.subtasks as DelegationSubtask[])
        await db
          .update(delegation)
          .set({ status: 'posted', subtasks, error: null, updatedAt: new Date() })
          .where(eq(delegation.id, dlgId))
        return toolText(id, `Posted ${subtasks.length} escrowed jobs. Track with delegation_status.`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await db.update(delegation).set({ error: message, updatedAt: new Date() }).where(eq(delegation.id, dlgId))
        return toolText(id, `Posting failed: ${message}`, true)
      }
    }

    case 'delegation_status': {
      const rows = await db
        .select()
        .from(delegation)
        .where(eq(delegation.userId, auth.userId))
        .orderBy(desc(delegation.createdAt))
        .limit(10)
      if (rows.length === 0) return toolText(id, 'No delegations yet.')

      const hasActive = rows.some((r) => r.status === 'posted')
      const { readJobs } = await import('@/lib/onchain/labor')
      const jobs = hasActive ? await readJobs().catch(() => []) : []
      if (hasActive) {
        const active = rows.filter((r) => r.status === 'posted')
        after(async () => {
          const { sweepStuckGradedJobs } = await import('@/lib/labor-settle')
          await sweepStuckGradedJobs().catch(() => {})
          for (const row of active) await tickDelegation(row, jobs).catch(() => {})
        })
      }

      const blocks: string[] = []
      for (const row of rows) {
        const views = row.status === 'planned' ? [] : await subtaskViews(row, jobs)
        const subLines = views
          .map((v) => `   - ${v.failed ? '❌' : v.jobStatus ?? '…'} ${v.title} ($${v.bountyUsd.toFixed(2)})${v.workerLabel ? ` by ${v.workerLabel}` : ''}`)
          .join('\n')
        blocks.push(
          `${row.id} [${row.status}] $${Number(row.budgetUsd).toFixed(2)} — ${row.task.slice(0, 80)}` +
            (subLines ? `\n${subLines}` : '') +
            (row.finalOutput ? `\n   FINAL OUTPUT:\n${row.finalOutput.slice(0, 2000)}` : '') +
            (row.error ? `\n   error: ${row.error}` : ''),
        )
      }
      return toolText(id, blocks.join('\n\n'))
    }

    case 'browse_open_jobs': {
      const { readJobs } = await import('@/lib/onchain/labor')
      const jobs = (await readJobs().catch(() => [])).filter((j) => j.status === 'Open')
      if (jobs.length === 0) return toolText(id, 'No open jobs right now.')
      const { jobSpec } = await import('@/lib/db/schema')
      const specs = await db.select().from(jobSpec)
      const byHash = new Map(specs.map((s) => [s.specHash, s]))
      const lines = jobs.map((j) => {
        const spec = byHash.get(j.specHash)
        return `#${j.id} · $${j.bounty} · ${spec?.title ?? 'Untitled'} (min score ${j.minScore})`
      })
      return toolText(id, lines.join('\n'))
    }

    default:
      return rpcError(id, -32602, `Unknown tool: ${name}`)
  }
}
