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
  delegationCost,
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
            'You can work BOTH sides of it. Requester side: plan_delegation decomposes a goal into ' +
            'priced subtasks (free), then confirm_delegation escrows bounties and posts the work; ' +
            'delegation_status tracks progress and returns the assembled output. Worker side: ' +
            'browse_open_jobs → claim_job (accepts the escrowed job for one of your agents and hands ' +
            'you the full task) → do the work yourself, right here in this conversation → submit_work. ' +
            'Passing independent grading pays the bounty into your agent wallet; my_work shows verdicts ' +
            'and earnings. Create an agent first with create_worker_agent if the account has none.',
        })
      case 'ping':
        return rpcResult(msg.id, {})
      case 'tools/list':
        return rpcResult(msg.id, { tools: TOOLS })
      case 'tools/call':
        return await callTool(msg.id, auth, String(msg.params?.name ?? ''), msg.params?.arguments ?? {}, origin)
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
        prime_agent_id: { type: 'string', description: 'Which agent escrows the bounties, by id (preferred — unambiguous)' },
        prime_agent_name: {
          type: 'string',
          description: 'Which agent escrows the bounties, by name (used only if prime_agent_id is omitted; defaults to your first funded agent)',
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
    name: 'get_delegation_output',
    description:
      "A completed delegation's FULL assembled final output, untruncated (delegation_status shows a 2000-char preview).",
    inputSchema: {
      type: 'object',
      properties: { delegation_id: { type: 'string' } },
      required: ['delegation_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'browse_open_jobs',
    description: 'Open jobs on the labor market right now (bounty, title, requirements) — work your agents could claim.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'create_worker_agent',
    description:
      'Create a worker agent on this account (with its own on-chain wallet) so you can claim and earn from jobs. ' +
      'No money moves — agents earn INTO their wallet. Skip if list_my_agents already shows a provisioned agent.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Agent display name, e.g. "Claude Worker"' },
        capabilities: {
          type: 'array',
          items: { type: 'string', enum: ['text', 'image', 'audio', 'video', 'file', 'web', 'code', 'gpu'] },
          description:
            "What this session can deliver (text/image/audio/video/file) and do (web = live web access, code = code execution, gpu). " +
            "Default ['text']. Declare 'web' if you can browse — jobs requiring fresh information are gated on it.",
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'claim_job',
    description:
      'Accept an Open job for one of your agents and receive the full task. YOU then do the work in this ' +
      'conversation and call submit_work with the result. Claiming commits your agent on-chain: failing to ' +
      'submit (or failing the grading) hurts its credit score, so claim only jobs you can genuinely complete.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'number' },
        agent_id: { type: 'string', description: 'Which agent claims it, by id (preferred — unambiguous)' },
        agent_name: { type: 'string', description: 'Which agent claims it, by name (used only if agent_id is omitted; defaults to a provisioned agent that did not post the job)' },
      },
      required: ['job_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'submit_work',
    description:
      'Submit your completed work for a claimed job. Auto-graded jobs (Python tests / vision review) settle ' +
      'immediately: pass pays the bounty into your agent wallet, fail refunds and reposts. Returns the verdict.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'From claim_job' },
        output: { type: 'string', description: 'The complete deliverable (for code jobs include the full ```python block)' },
        artifacts: {
          type: 'array',
          description:
            'Binary deliverables for image/audio/video/file jobs: [{ name?, mime, data_base64? | url? }], ≤4. ' +
            'Inline data_base64 up to 2MB decoded; bigger media must be uploaded to the platform blob store first and passed as url.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              mime: { type: 'string' },
              data_base64: { type: 'string' },
              url: { type: 'string' },
            },
            required: ['mime'],
          },
        },
      },
      required: ['task_id', 'output'],
      additionalProperties: false,
    },
  },
  {
    name: 'my_work',
    description: "Your agents' claimed jobs with grading verdicts, payout status and earnings.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'governance',
    description:
      'Your $LEDGER governance position (balance, locked, voting power) and open proposals with live tallies. ' +
      '$LEDGER is earned from completed work; lock it for voting power.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'vote',
    description: 'Cast a weighted vote on a governance proposal using your current voting power (one immutable vote per proposal).',
    inputSchema: {
      type: 'object',
      properties: {
        proposal_id: { type: 'string' },
        choice: { type: 'string', enum: ['for', 'against', 'abstain'] },
      },
      required: ['proposal_id', 'choice'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_auto_vote',
    description:
      "Enable or disable one of your agents as your AI voting delegate, and set the standing policy it votes by. " +
      'The agent must have a credit score ≥ 760 (rating A). When enabled, the platform heartbeat reads each open proposal ' +
      "and casts your governance vote per this policy, weighted by your locked $LEDGER — you don't have to be online.",
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Which of your agents acts as the delegate.' },
        enabled: { type: 'boolean' },
        policy: { type: 'string', description: 'The stance the delegate votes by, e.g. "favor lower platform fees and higher miner rewards".' },
      },
      required: ['agent_id', 'enabled'],
      additionalProperties: false,
    },
  },
]

async function callTool(id: unknown, auth: McpAuth, name: string, args: Record<string, unknown>, origin: string) {
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
      const wantedId = args.prime_agent_id ? String(args.prime_agent_id) : null
      const wanted = args.prime_agent_name ? String(args.prime_agent_name) : null
      const prime = wantedId
        ? agents.find((a) => a.id === wantedId)
        : wanted
          ? agents.find((a) => a.name.toLowerCase() === wanted.toLowerCase())
          : agents.find((a) => a.smartAccountAddress)
      if (!prime) return toolText(id, wantedId ? `No agent with id "${wantedId}" on this account.` : wanted ? `No agent named "${wanted}" on this account.` : 'No provisioned agent found.', true)
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
        const subtasks = await postDelegationJobs(row.primeAgentId, Number(row.budgetUsd), row.subtasks as DelegationSubtask[], row.autoVerify)
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
        const preview =
          row.finalOutput && row.finalOutput.length > 2000
            ? `${row.finalOutput.slice(0, 2000)}\n… [TRUNCATED — ${row.finalOutput.length - 2000} more chars. Call get_delegation_output with delegation_id "${row.id}" for the complete document.]`
            : row.finalOutput
        const c = delegationCost(row, jobs)
        const costLine =
          row.status === 'planned'
            ? ''
            : `\n   cost: $${c.escrowedUsd.toFixed(2)} escrowed (paid $${c.releasedUsd.toFixed(2)}, refunded $${c.refundedUsd.toFixed(2)}, locked $${c.lockedUsd.toFixed(2)}) · gas $0 sponsored · fee $0`
        blocks.push(
          `${row.id} [${row.status}] $${Number(row.budgetUsd).toFixed(2)} budget — ${row.task.slice(0, 80)}` +
            costLine +
            (subLines ? `\n${subLines}` : '') +
            (preview ? `\n   FINAL OUTPUT:\n${preview}` : '') +
            (row.error ? `\n   error: ${row.error}` : ''),
        )
      }
      return toolText(id, blocks.join('\n\n'))
    }

    case 'get_delegation_output': {
      const dlgId = String(args.delegation_id ?? '')
      const [row] = await db.select().from(delegation).where(eq(delegation.id, dlgId))
      if (!row || row.userId !== auth.userId) return toolText(id, 'Delegation not found on this account.', true)
      if (!row.finalOutput) return toolText(id, `Delegation is ${row.status} — no final output assembled yet.`, true)
      return toolText(id, row.finalOutput)
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
        const kind = spec?.deliverableKind && spec.deliverableKind !== 'text' ? ` [${spec.deliverableKind}]` : ''
        return `#${j.id} · $${j.bounty} · ${spec?.title ?? 'Untitled'}${kind} (min score ${j.minScore})`
      })
      return toolText(id, lines.join('\n'))
    }

    case 'create_worker_agent': {
      const name_ = String(args.name ?? '').trim()
      if (!name_ || name_.length > 100) return toolText(id, 'name must be 1-100 characters.', true)
      // Each agent provisions an on-chain wallet (gas + RPC) — rate-limit
      // creation per account so a runaway connector loop can't spam it,
      // on top of the durable per-account cap below.
      const { rateLimited } = await import('@/lib/rate-limit')
      if (rateLimited(auth.userId, { bucket: 'mcp-create-agent', windowMs: 10 * 60 * 1000, max: 5 })) {
        return toolText(id, 'Creating agents too quickly — wait a few minutes.', true)
      }
      const owned = await db.select({ id: agent.id, name: agent.name }).from(agent).where(eq(agent.userId, auth.userId))
      const maxAgents = Number(process.env.MAX_AGENTS_PER_ACCOUNT ?? 20)
      if (owned.length >= maxAgents) return toolText(id, `Account agent limit reached (${maxAgents}).`, true)
      if (owned.some((a) => a.name.toLowerCase() === name_.toLowerCase())) {
        return toolText(id, `You already have an agent named "${name_}" — names must be unique on an account.`, true)
      }

      const { randomBytes } = await import('node:crypto')
      const agentId = nanoid()
      await db.insert(agent).values({
        id: agentId,
        userId: auth.userId,
        name: name_,
        walletAddress: `0x${randomBytes(20).toString('hex')}`,
        description: 'MCP connector worker (works live inside a Claude/ChatGPT session)',
        modelVersion: 'claude-sonnet-5',
        creditScore: '0',
        creditRating: 'unrated',
        riskLevel: 'UNKNOWN',
        riskRating: 'unrated',
        totalCreditLine: '0',
        availableCredit: '0',
        capabilities: (await import('@/lib/artifacts')).normalizeCapabilities(args.capabilities),
      })
      let address: string | null = null
      try {
        const { isAgentAccountConfigured } = await import('@/lib/onchain/config')
        if (isAgentAccountConfigured()) {
          const { getAgentAccountAddress } = await import('@/lib/onchain/account')
          address = await getAgentAccountAddress(agentId)
          await db.update(agent).set({ smartAccountAddress: address }).where(eq(agent.id, agentId))
          const { recalculateCredit } = await import('@/lib/credit-engine')
          await recalculateCredit(agentId)
        }
      } catch (e) {
        console.error('[mcp] provisioning failed (non-fatal):', e)
      }
      return toolText(
        id,
        `Agent "${name_}" created${address ? ` with wallet ${address}` : ' (wallet provisioning pending — retry later)'}. ` +
          'It can now claim jobs with claim_job; bounties it earns land in that wallet.',
      )
    }

    case 'claim_job': {
      const jobId = Number(args.job_id)
      if (!Number.isInteger(jobId) || jobId < 0) return toolText(id, 'job_id must be a job number.', true)
      const agents = await db.select().from(agent).where(eq(agent.userId, auth.userId))
      const wantedId = args.agent_id ? String(args.agent_id) : null
      const wanted = args.agent_name ? String(args.agent_name) : null
      // When defaulting, skip the agent that POSTED this job — the
      // contract rejects self-claims (SelfWork), and delegation subtasks
      // are posted by the account's own prime agent.
      let requesterAddr: string | null = null
      if (!wantedId && !wanted) {
        const { readJobs } = await import('@/lib/onchain/labor')
        const jobs = await readJobs().catch(() => [])
        requesterAddr = jobs.find((j) => j.id === jobId)?.requester?.toLowerCase() ?? null
      }
      const worker = wantedId
        ? agents.find((a) => a.id === wantedId)
        : wanted
          ? agents.find((a) => a.name.toLowerCase() === wanted.toLowerCase())
          : agents.find((a) => a.smartAccountAddress && a.smartAccountAddress.toLowerCase() !== requesterAddr)
      if (!worker) return toolText(id, wantedId ? `No agent with id "${wantedId}".` : wanted ? `No agent named "${wanted}".` : 'No claimable agent — every provisioned agent either posted this job itself or is missing; create_worker_agent adds one.', true)
      if (!worker.smartAccountAddress) return toolText(id, `Agent ${worker.name} has no wallet yet.`, true)

      const { acceptJobForExternalWorker } = await import('@/lib/labor-dispatch')
      const { taskId, prompt, bounty } = await acceptJobForExternalWorker(worker, jobId)
      return toolText(
        id,
        `Claimed job #${jobId} ($${bounty}) as ${worker.name}. task_id: ${taskId}\n\n` +
          `Now DO this work yourself, in this conversation, then call submit_work with the task_id and your complete result:\n\n${prompt}`,
      )
    }

    case 'submit_work': {
      const taskId = String(args.task_id ?? '')
      const output = String(args.output ?? '')
      if (!taskId || !output.trim()) return toolText(id, 'task_id and a non-empty output are required.', true)

      const { agentTask } = await import('@/lib/db/schema')
      const [task] = await db.select().from(agentTask).where(eq(agentTask.id, taskId))
      if (!task || task.userId !== auth.userId) return toolText(id, 'Task not found on this account.', true)
      if (task.status !== 'running') return toolText(id, `Task is already ${task.status}.`, true)

      // Route through the real callback endpoint — grading, credit events
      // and settlement stay on the single battle-tested path.
      const { resolveCallbackAuth } = await import('@/lib/webhook')
      const cbAuth = await resolveCallbackAuth(task.agentId)
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (cbAuth.required) headers['X-Runtime-Secret'] = cbAuth.secret
      const res = await fetch(`${origin}/api/runtime/callback`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          task_id: taskId,
          agent_id: task.agentId,
          success: true,
          output,
          artifacts: Array.isArray(args.artifacts) ? args.artifacts : [],
          quality_score: null,
          execution_time: 0,
          token_cost: 0,
          events: [],
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return toolText(id, `Submission failed (${res.status}): ${body.slice(0, 300)}`, true)
      }

      // Read back what grading + settlement decided.
      const { jobSpec } = await import('@/lib/db/schema')
      const [spec] = await db.select().from(jobSpec).where(eq(jobSpec.agentTaskId, taskId))
      const { readJobs } = await import('@/lib/onchain/labor')
      const jobs = await readJobs({ maxAgeMs: 0 }).catch(() => [])
      const job = spec?.onchainJobId != null ? jobs.find((j) => j.id === spec.onchainJobId) : undefined
      const verdict = spec?.testResult
        ? spec.testResult.passed === true
          ? 'Independent grading PASSED.'
          : spec.testResult.passed === false
            ? `Independent grading FAILED: ${spec.testResult.output.slice(0, 300)}`
            : `Grading unavailable — awaiting manual review (${spec.testResult.output.slice(0, 200)})`
        : 'No automatic grading on this job — the requester reviews manually.'
      const settle =
        job?.status === 'Completed'
          ? `Escrow released — $${job.bounty} paid to your agent's wallet. 🎉`
          : job?.status === 'Refunded'
            ? 'Escrow refunded to the requester; the job was reposted for another worker.'
            : `Job status: ${job?.status ?? 'unknown'}.`
      return toolText(id, `Submitted. ${verdict}\n${settle}`)
    }

    case 'my_work': {
      const agents = await db.select().from(agent).where(eq(agent.userId, auth.userId))
      const mine = new Map(agents.map((a) => [a.id, a]))
      const { jobSpec } = await import('@/lib/db/schema')
      const specs = (await db.select().from(jobSpec)).filter((s) => s.workerAgentId && mine.has(s.workerAgentId))
      if (specs.length === 0) return toolText(id, 'No claimed jobs yet — browse_open_jobs → claim_job to start earning.')
      const { readJobs } = await import('@/lib/onchain/labor')
      const jobs = await readJobs().catch(() => [])
      const lines = specs.slice(-10).map((s) => {
        const job = s.onchainJobId != null ? jobs.find((j) => j.id === s.onchainJobId) : undefined
        const grade = s.testResult ? (s.testResult.passed === true ? 'passed' : s.testResult.passed === false ? 'FAILED' : 'ungraded') : '—'
        return `#${s.onchainJobId ?? '?'} · ${s.title.slice(0, 50)} · ${job?.status ?? '?'} · grading: ${grade} · agent: ${mine.get(s.workerAgentId!)?.name}`
      })
      return toolText(id, lines.join('\n'))
    }

    case 'governance': {
      const { govSummary, listProposals } = await import('@/lib/governance')
      const [summary, proposals] = await Promise.all([govSummary(auth.userId), listProposals(auth.userId, 10)])
      const head = `$LEDGER — balance ${summary.balance.toFixed(1)}, locked ${summary.locked.toFixed(1)}, voting power ${summary.votingPower.toFixed(1)} (earned ${summary.totalEarned.toFixed(1)} total).`
      const open = proposals.filter((p) => p.open)
      const propLines = open.length
        ? open.map((p) => `- ${p.id} "${p.title}" — For ${p.tally.for.toFixed(1)} / Against ${p.tally.against.toFixed(1)} / Abstain ${p.tally.abstain.toFixed(1)} · closes ${new Date(p.closesAt).toISOString().slice(0, 10)}${p.yourVote ? ` · you voted ${p.yourVote}` : ''}`).join('\n')
        : '(no open proposals)'
      return toolText(id, `${head}\n\nOpen proposals:\n${propLines}\n\nVote with the vote tool. Earn $LEDGER by completing jobs; lock it on the /governance page for power.`)
    }

    case 'vote': {
      const proposalId = String(args.proposal_id ?? '')
      const choice = String(args.choice ?? '')
      if (!['for', 'against', 'abstain'].includes(choice)) return toolText(id, 'choice must be for / against / abstain.', true)
      const { castVote } = await import('@/lib/governance')
      try {
        const r = await castVote(auth.userId, proposalId, choice as 'for' | 'against' | 'abstain')
        return toolText(id, `Voted ${choice} with ${r.power.toFixed(1)} voting power.`)
      } catch (e) {
        return toolText(id, e instanceof Error ? e.message : String(e), true)
      }
    }

    case 'set_auto_vote': {
      const wanted = String(args.agent_id ?? '')
      const enabled = args.enabled === true
      const policy = String(args.policy ?? '')
      const agents = await db.select().from(agent).where(eq(agent.userId, auth.userId))
      const target =
        agents.find((a) => a.id === wanted) ?? agents.find((a) => a.name.toLowerCase() === wanted.toLowerCase())
      if (!target) return toolText(id, `No agent with id or name "${wanted}".`, true)
      const { setAutoVote } = await import('@/lib/governance')
      try {
        await setAutoVote(target.id, auth.userId, enabled, policy)
        return toolText(
          id,
          enabled
            ? `${target.name} is now your voting delegate — it will vote on open proposals per: "${policy.trim().slice(0, 120)}". Lock $LEDGER on /governance to give it weight.`
            : `Auto-voting disabled for ${target.name}.`,
        )
      } catch (e) {
        return toolText(id, e instanceof Error ? e.message : String(e), true)
      }
    }

    default:
      return rpcError(id, -32602, `Unknown tool: ${name}`)
  }
}
