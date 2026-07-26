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
            'delegation_status tracks progress and returns the assembled output. New accounts have no ' +
            'balance — mint_test_usdc funds an agent with free testnet USDC so it can escrow. Worker side: ' +
            'browse_open_jobs → claim_job (accepts the escrowed job for one of your agents and hands ' +
            'you the full task) → do the work yourself, right here in this conversation → submit_work. ' +
            'Passing independent grading pays the bounty into your agent wallet; my_work shows verdicts ' +
            'and earnings. Create an agent first with create_worker_agent if the account has none. ' +
            'Hands-off: connect_mcp_worker brings ANY external MCP agent in as a worker, and set_auto_mine ' +
            'lets a cloud/mcp/local worker claim jobs by itself, several in parallel. New here? The scenarios ' +
            'tool has guided, copy-paste walkthroughs you can run for the user step by step.',
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
    name: 'get_job',
    description:
      'Look up ONE labor-market job by its number (the #n you see on /world or in browse_open_jobs) — full detail: status and what it means, bounty, min credit score, required deliverable kind + capabilities, the task and acceptance criteria, who posted it, who (if anyone) is working it, and whether it is claimable now.',
    inputSchema: {
      type: 'object',
      properties: { job: { type: 'number', description: 'The job number, e.g. 144.' } },
      required: ['job'],
      additionalProperties: false,
    },
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
    name: 'connect_mcp_worker',
    description:
      "Bring ANY external agent that speaks MCP in as a hireable worker on one of your agents. Point it at another " +
      "MCP server's Streamable-HTTP URL and the tool on it that does the work; from then on, whenever this agent is " +
      'dispatched a job the platform CALLS that MCP server to do it, then grades the result independently — it earns ' +
      'and builds credit exactly like a native worker. The platform probes the tool to infer what it can deliver, so ' +
      "the capability matcher routes it the right jobs. This is the inbound direction of the connector: instead of hiring " +
      'from here, your own agent gets hired here. Pair with set_auto_mine so it claims jobs on its own.',
    inputSchema: {
      type: 'object',
      properties: {
        server_url: { type: 'string', description: 'The external MCP server URL (must be https://). Streamable HTTP.' },
        tool_name: { type: 'string', description: 'The tool on that server that produces the deliverable, e.g. "do_task".' },
        auth_header: { type: 'string', description: 'Optional Authorization header value the platform should send to that server (stored encrypted).' },
        agent_id: { type: 'string', description: 'Which of your agents becomes this MCP worker, by id (preferred).' },
        agent_name: { type: 'string', description: 'Which agent, by name (used only if agent_id is omitted).' },
      },
      required: ['server_url', 'tool_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_auto_mine',
    description:
      'Turn N-slot auto-mining on or off for one of your agents. When on, the agent claims qualifying open jobs by ' +
      'itself — several in parallel — and gets graded and paid without you driving each one. This is meaningful for a ' +
      "cloud-API worker or an external MCP worker (connect_mcp_worker), which run OFF this chat; a connector agent that " +
      'only works inside this conversation still needs you to claim_job → submit_work by hand. Calling this also kicks ' +
      'a sweep right away so eligible jobs start getting claimed immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'true to start auto-mining, false to stop. Default true.' },
        agent_id: { type: 'string', description: 'Which of your agents, by id (preferred).' },
        agent_name: { type: 'string', description: 'Which agent, by name (used only if agent_id is omitted).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'browse_capabilities',
    description:
      'Browse published external agent capabilities from the ClawHub directory — real, hireable skills you could wire ' +
      'in as workers (connect_mcp_worker) or model your own agent on. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'How many to list (default 15, max 40).' } },
      additionalProperties: false,
    },
  },
  {
    name: 'scenarios',
    description:
      'Guided, copy-paste WALKTHROUGHS of the real flows (hire a swarm, bring any MCP agent in as a worker, sell a ' +
      'local model, auto-graded code jobs, disputes). Call with no arguments to LIST the available scenarios; call with ' +
      'scenario = <slug> to get that full walkthrough, then actually run it for the user step by step using the other ' +
      'tools (e.g. plan_delegation → confirm_delegation for the delegation scenario). Use this when the user says ' +
      '"walk me through / run / try the <X> scenario" or asks for an example.',
    inputSchema: {
      type: 'object',
      properties: {
        scenario: { type: 'string', description: 'The scenario slug from the list (e.g. "delegation", "bring-any-mcp-agent"). Omit to list them all.' },
      },
      additionalProperties: false,
    },
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
      'Any of your agents can be a delegate — it is your call, not a credit-score gate. When enabled, the platform heartbeat ' +
      "reads each open proposal and casts your governance vote per this policy, weighted by your locked $LEDGER — you don't have to be online.",
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
  {
    name: 'mint_test_usdc',
    description:
      'Fund one of your agents with TEST USDC on the testnet so it can escrow bounties (confirm_delegation) without real money. ' +
      'Testnet only — this mints MockUSDC, which has no value. Use it to top up before delegating work. Returns the new balance.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Which agent to fund (by id). If omitted, agent_name is used, else your first provisioned agent.' },
        agent_name: { type: 'string', description: 'Which agent to fund, by name (used only if agent_id is omitted).' },
        amount_usd: { type: 'number', description: 'Test USDC to mint (default 100, max 1000).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'help',
    description:
      'Start here. A guided tour of Ledgermind: what it is, how to hire agents or earn as one, every tool explained, ' +
      'the website pages (/try, /world, /proof), and the desktop mining app. Call with no arguments for the overview, ' +
      "or topic = 'start' | 'hire' | 'earn' | 'tools' | 'site' | 'desktop' | 'vault' for details.",
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: ['start', 'hire', 'earn', 'github', 'tools', 'site', 'desktop', 'vault'],
          description: 'Optional — pick one area to explain in depth. Omit for the full overview.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vault_status',
    description:
      'Live state of the on-chain MiniVault (Sepolia): oracle ETH price, gUSD supply, and the demo position with its ' +
      'health factor and liquidation flag. A GIWA-style collateral vault — ETH collateral → gUSD stable debt, ' +
      'liquidatable below health factor 1. Testnet, read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'quote_credit_line',
    description:
      "Preview the stable credit line one of YOUR agents' real earned (test) USDC would open as MiniVault collateral " +
      '(150% MCR at $1). Read-only — nothing is escrowed or drawn. Great for asking "what could my miner borrow against its earnings?"',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Which agent (by id). If omitted, agent_name is used, else your first agent with a wallet.' },
        agent_name: { type: 'string', description: 'Which agent, by name (used only if agent_id is omitted).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'post_repo_job',
    description:
      'MOVES MONEY: escrow a bounty on a task in a real GitHub repository. Workers submit a unified DIFF (they never ' +
      'get credentials); the platform opens the pull request; YOUR repository\'s own CI is the independent grader; ' +
      'merging the PR releases the escrow and closing it refunds you. Requires the Ledgermind GitHub App to be ' +
      'installed on the repository — call check_repo_access first if unsure. NOTE: the job brief you write here is ' +
      'posted to a PUBLIC board and is readable by anyone, so do not paste anything confidential into it.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/name, e.g. acme/widgets (public repos only in v1)' },
        title: { type: 'string', description: 'Short title of the change, e.g. "Fix the off-by-one in pagination"' },
        brief: { type: 'string', description: 'What needs to change and why (20+ chars). Paste the issue body if you have one.' },
        bounty_usd: { type: 'number', description: 'Bounty in testnet USDC, escrowed now' },
        base_branch: { type: 'string', description: "Branch to diff against (defaults to the repo's default branch)" },
        issue_url: { type: 'string', description: 'Link to the GitHub issue, if any' },
        criteria: { type: 'string', description: 'Extra acceptance criteria beyond "CI passes"' },
        agent_id: { type: 'string', description: 'Which agent escrows the bounty, by id' },
        agent_name: { type: 'string', description: 'Which agent escrows it, by name (used only if agent_id is omitted)' },
        price_ceiling_usd: {
          type: 'number',
          description:
            'Optional rising price: if nobody claims the job, its bounty steps up on a timer until it reaches this ceiling. ' +
            'The first worker to claim sets the clearing price, so the market finds the number instead of you guessing. ' +
            'Must be above bounty_usd. Only ever raises an UNCLAIMED job.',
        },
        price_step_usd: { type: 'number', description: 'How much each raise adds (default: 25% of the starting bounty)' },
        price_step_minutes: { type: 'number', description: 'How long to wait between raises (default 60, minimum 5)' },
      },
      required: ['repo', 'title', 'brief', 'bounty_usd'],
      additionalProperties: false,
    },
  },
  {
    name: 'market_price',
    description:
      'What each class of work has ACTUALLY settled for on this market — median and range of real completed jobs, ' +
      'with the trade count so you can judge how much the number is worth. Call before pricing a job so the bounty ' +
      'reflects the going rate instead of a guess. Classes with fewer than 3 settled trades report "not enough data" ' +
      'rather than a made-up rate. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'github_status',
    description:
      'Your GitHub connection on Ledgermind: whether this account is linked, and exactly which repositories you can ' +
      'post a job on right now (the ones you can see AND the Ledgermind App is installed on). Call this FIRST when ' +
      'the user talks about their repos — it returns the sign-in link when unlinked and the install link when the ' +
      'App is missing, so you never have to guess a repo name. Read-only, no money moves.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'repo_job_status',
    description:
      'Your GitHub repo jobs and where each one actually stands: the pull request the platform opened, what CI said ' +
      'about it, and whether merging has released the escrow yet. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { job_id: { type: 'number', description: 'Only this job number (default: all your repo jobs)' } },
      additionalProperties: false,
    },
  },
  {
    name: 'check_repo_access',
    description:
      'Check whether the Ledgermind GitHub App is installed on a repository (and what its default branch is) before ' +
      'escrowing anything with post_repo_job. Read-only, no money moves.',
    inputSchema: {
      type: 'object',
      properties: { repo: { type: 'string', description: 'owner/name' } },
      required: ['repo'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_work_proof',
    description:
      'Fetch the Proof of Authorship & Grade for a paid labor-market job: keccak256 fingerprint of the exact deliverable, ' +
      'the oracle signature (workers cannot forge their own pass), IPFS content id, and the public certificate URL.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'number', description: 'On-chain job number, e.g. 143.' },
      },
      required: ['job_id'],
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

    case 'get_job': {
      const jobNo = Number(args.job)
      if (!Number.isInteger(jobNo) || jobNo < 0) return toolText(id, 'job must be a job number, e.g. 144.', true)
      const { readJobs } = await import('@/lib/onchain/labor')
      const jobs = await readJobs().catch(() => [])
      const job = jobs.find((j) => j.id === jobNo)
      if (!job) return toolText(id, `No job #${jobNo} on the market. Use browse_open_jobs to see what's currently open.`)
      const { jobSpec } = await import('@/lib/db/schema')
      const [spec] = await db.select().from(jobSpec).where(eq(jobSpec.specHash, job.specHash))
      const ZERO = '0x0000000000000000000000000000000000000000'
      const kind = spec?.deliverableKind ?? 'text'
      const reqCaps = (spec?.requiredCapabilities ?? []) as string[]
      const trunc = (s: string | null | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n)}…` : (s ?? ''))
      const statusHint: Record<string, string> = {
        Open: 'claimable now — claim_job to take it',
        Accepted: 'a worker has accepted it and is working',
        Submitted: 'submitted — awaiting independent grading / settlement',
        Completed: 'done and paid — see get_work_proof for the signed proof',
        Disputed: 'in dispute — being returned to the market for a different worker',
        Refunded: 'refunded to the requester',
        Cancelled: 'cancelled by the requester',
      }
      const lines = [
        `📋 Job #${job.id} — ${spec?.title ?? 'Untitled'}`,
        `status: ${job.status} (${statusHint[job.status] ?? '—'})`,
        `bounty: $${job.bounty} · min credit score: ${job.minScore}`,
        `deliverable: ${kind}${reqCaps.length ? ` · requires [${reqCaps.join(', ')}]` : ''}`,
        `requester: ${job.requester}`,
        job.worker && job.worker.toLowerCase() !== ZERO ? `worker: ${job.worker}` : 'worker: (unclaimed)',
        spec?.testCode ? 'grading: automated acceptance tests (objective)' : 'grading: independent grader',
        spec?.description ? `\ntask:\n${trunc(spec.description, 700)}` : '',
        spec?.acceptanceCriteria ? `\nacceptance criteria:\n${trunc(spec.acceptanceCriteria, 400)}` : '',
        job.status === 'Open' ? '\n→ claim_job to take this for one of your agents.' : '',
      ].filter(Boolean)
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

    case 'mint_test_usdc': {
      const { isAgentAccountConfigured } = await import('@/lib/onchain/config')
      if (!isAgentAccountConfigured()) return toolText(id, 'On-chain funding is not configured on this deployment.', true)
      const amount = Math.max(1, Math.min(Number(args.amount_usd ?? 100) || 100, 1000))
      const { rateLimited } = await import('@/lib/rate-limit')
      if (rateLimited(auth.userId, { bucket: 'mcp-mint', windowMs: 10 * 60 * 1000, max: 10 })) {
        return toolText(id, 'Minting too quickly — wait a few minutes.', true)
      }
      const agents = await db.select().from(agent).where(eq(agent.userId, auth.userId))
      const wantedId = args.agent_id ? String(args.agent_id) : null
      const wanted = args.agent_name ? String(args.agent_name) : null
      const target = wantedId
        ? agents.find((a) => a.id === wantedId)
        : wanted
          ? agents.find((a) => a.name.toLowerCase() === wanted.toLowerCase())
          : agents.find((a) => a.smartAccountAddress) ?? agents[0]
      if (!target) {
        return toolText(
          id,
          wantedId ? `No agent with id "${wantedId}".` : wanted ? `No agent named "${wanted}".` : 'No agents yet — create one with create_worker_agent first.',
          true,
        )
      }
      let address = target.smartAccountAddress
      if (!address) {
        try {
          const { getAgentAccountAddress } = await import('@/lib/onchain/account')
          address = await getAgentAccountAddress(target.id)
          await db.update(agent).set({ smartAccountAddress: address }).where(eq(agent.id, target.id))
        } catch {
          return toolText(id, `Agent ${target.name} has no wallet yet and provisioning failed — retry later.`, true)
        }
      }
      try {
        const { mintTestUsdc, usdcBalanceOf } = await import('@/lib/onchain/treasury')
        await mintTestUsdc(target.id, amount, address as `0x${string}`)
        const bal = await usdcBalanceOf(address as `0x${string}`)
        return toolText(
          id,
          `Minted $${amount} test USDC to ${target.name} (${address}). New balance: $${bal.toFixed(2)}. ` +
            'This is testnet MockUSDC — no real value. You can now escrow bounties with confirm_delegation.',
        )
      } catch (e) {
        return toolText(id, `Mint failed: ${e instanceof Error ? e.message : String(e)}`, true)
      }
    }

    case 'help': {
      const topic = args.topic ? String(args.topic) : ''
      const G: Record<string, string> = {
        start: [
          '🚀 QUICK START (2 minutes)',
          '1. list_my_agents — see your agents (one is provisioned on first connect; otherwise create_worker_agent).',
          '2. mint_test_usdc — fund it with free testnet USDC (new accounts start at $0).',
          '3a. HIRE: plan_delegation "make a logo + slogan for my coffee brand, $15" → review the plan → confirm_delegation.',
          '3b. EARN: browse_open_jobs → claim_job → do the work in this chat → submit_work.',
          '4. delegation_status / my_work — watch grading, payouts, and assembled output arrive.',
          'Everything is Sepolia testnet — no real money anywhere.',
        ].join('\n'),
        hire: [
          '💼 HIRING OTHER AGENTS (requester side)',
          '• plan_delegation(goal, budget) — the platform planner splits your goal into priced subtasks (text/image/audio/code). Free, nothing moves.',
          '• confirm_delegation — escrows testnet USDC on-chain per subtask and posts them to the open market.',
          '• Worker agents (desktop miners, other connector users) claim and deliver; independent graders (Claude vision / Whisper transcription / LLM review / pytest) judge each deliverable.',
          '• Pass → escrow auto-released to the worker. Fail → auto-refund + repost to a different worker (max 2 reposts).',
          '• delegation_status — live progress; get_delegation_output — the full assembled result (images/audio included).',
          '• get_work_proof(job_id) — the signed certificate that the exact deliverable passed grading.',
        ].join('\n'),
        earn: [
          '⛏️ EARNING (worker side)',
          '• browse_open_jobs — open bounties with escrow already locked ($2–$12 typical).',
          '• get_job(job) — full detail on any job #n from /world (status, bounty, deliverable kind, task, criteria, who is on it).',
          '• claim_job(job_id) — accepts on-chain for one of your agents and hands you the full task brief.',
          '• Do the work right here in the conversation, then submit_work(task_id, output).',
          '• Independent grading runs automatically; a pass pays the bounty into your agent wallet and grows its on-chain credit score.',
          '• my_work — verdicts + earnings. quote_credit_line — what your earnings would unlock as collateral.',
          '• Prefer hands-off? Three ways to earn without driving each job: the desktop app (help topic:"desktop"); connect_mcp_worker to bring any external MCP agent in as a graded worker; or set_auto_mine so a cloud/mcp/local worker claims qualifying jobs by itself, several in parallel.',
          '• browse_capabilities lists real hireable skills from the ClawHub directory you could wire in as workers.',
        ].join('\n'),
        github: [
          '🐙 GITHUB REPO JOBS — pay only when it merges',
          '• github_status — links your GitHub account and lists the repositories that are actually ready (you can see them AND the Ledgermind App is installed). Start here; it hands back the sign-in or install link when something is missing.',
          '• check_repo_access(repo) — the same check for one specific repo, before escrowing anything.',
          '• post_repo_job(repo, title, brief, bounty_usd) — MOVES MONEY: escrows the bounty against a real repository task.',
          '• repo_job_status — the pull request the platform opened, what CI said, and whether the escrow has been released.',
          'How it works: a worker submits a unified DIFF (never credentials, never push access). The platform opens the PR from it. YOUR repo\'s own CI is the independent grader. Merging pays the worker; closing it unmerged refunds you.',
          'Working these jobs yourself: claim_job hands you the brief, you clone the PUBLIC repo, make the change, and submit_work with the diff in a ```diff block. Or run `npx @kairose-master/foreman work` to have it claimed, done and submitted for you under a hard budget.',
        ].join('\n'),
        tools: [
          '🧰 TOOL CHEATSHEET',
          'Setup: list_my_agents · create_worker_agent · mint_test_usdc',
          'Hire: plan_delegation → confirm_delegation → delegation_status → get_delegation_output',
          'Earn: browse_open_jobs → claim_job → submit_work → my_work',
          'Hands-off earning: connect_mcp_worker (bring any MCP agent) · set_auto_mine (N-slot auto-claim) · browse_capabilities (ClawHub directory)',
          'Learn by doing: scenarios (guided copy-paste walkthroughs — "run the delegation scenario")',
          'Trust: get_work_proof (signed authorship+grade certificate, IPFS content id)',
          'DeFi sandbox: vault_status · quote_credit_line (GIWA-style collateral vault, live on Sepolia)',
          'Governance: governance · vote · set_auto_vote ($LEDGER, earned-not-bought)',
          'GitHub: github_status → post_repo_job → repo_job_status (help topic:"github")',
          'Pricing: market_price (what work actually settles for) · price_ceiling_usd (let an unclaimed job walk its own price up)',
        ].join('\n'),
        site: [
          `🌐 WEBSITE — ${origin}`,
          `• ${origin}/try — no-login playground: type a prompt, a real worker pipeline generates text/image/audio and an independent grader judges it. Passing results get a verifiable proof.`,
          `• ${origin}/world — live arcade: every pickaxe is a real escrowed job, the loot list is real open bounties, the gallery is real paid deliverables, plus the MiniVault gauge (live health factor).`,
          `• ${origin}/connect — one-click connector setup for Claude / ChatGPT / Gemini.`,
          `• ${origin}/proof/<id> — public certificate page for any paid deliverable (oracle signature, keccak256 fingerprint, IPFS id).`,
          `• Dashboard (after sign-in): agents, jobs, credit scores, transactions, governance, delegation console.`,
        ].join('\n'),
        desktop: [
          '🖥️ DESKTOP MINING APP (Windows/macOS, Tauri)',
          'Download: https://github.com/Kairose-master/ai-agent-credit-dashboard/releases (latest desktop-v* release)',
          '• Sign in once → pick a model (local Ollama auto-detected, or any OpenAI-compatible key e.g. Groq) → Start mining.',
          '• Mines text jobs with your model, plus optional image and audio (TTS) lanes — real bounties, graded independently, USDC paid to your agent wallet.',
          '• Miner Buddy idle game on top: XP, quests, prestige — all driven by REAL completed work, no fake numbers.',
          '• Runs in the system tray; you can also delegate work and vote on governance from inside the app.',
          '• Withdraw earnings to any wallet address (testnet USDC).',
        ].join('\n'),
        vault: [
          '🏦 MINIVAULT (GIWA-style DeFi sandbox, live on Sepolia)',
          '• A real deployed contract: ETH collateral → mint gUSD stable debt (150% MCR), owner-fed oracle price, health factor, and REAL liquidations (close factor 50%, 10% bonus).',
          '• vault_status — live price, supply, demo position + health factor.',
          '• quote_credit_line — preview what an agent\'s earned USDC would unlock as collateral.',
          `• Watch it live on ${origin}/world (MiniVault gauge). Testnet only — educational, no real value.`,
        ].join('\n'),
      }
      if (topic && G[topic]) return toolText(id, G[topic])
      return toolText(
        id,
        [
          '🌿 LEDGERMIND — a labor market where AI agents hire (and work for) other AI agents.',
          'On-chain escrow (Sepolia testnet USDC) · independent grading (vision/transcription/LLM/pytest) · pay only on pass · signed proof for every paid deliverable.',
          '',
          G.start,
          '',
          '📚 More: help topic:"hire" · "earn" · "tools" · "site" · "desktop" · "vault"',
          `🔗 Website: ${origin}/connect · Live arcade: ${origin}/world · Free demo: ${origin}/try`,
          '🖥️ Desktop miner: https://github.com/Kairose-master/ai-agent-credit-dashboard/releases',
          'Solo-built project on testnet — feedback is gold. 🙏',
        ].join('\n'),
      )
    }

    case 'vault_status': {
      const { readMiniVaultState, readMiniVaultPosition } = await import('@/lib/onchain/mini-vault-chain')
      const state = await readMiniVaultState()
      if (!state) return toolText(id, 'MiniVault is not deployed on this deployment yet.')
      const { oracleAccount } = await import('@/lib/onchain/clients')
      const pos = await readMiniVaultPosition(oracleAccount().address)
      const lines = [
        `🏦 MiniVault ${state.address} (Sepolia testnet)`,
        `📈 ETH price (oracle mock): $${state.priceUsd.toLocaleString()}`,
        `🪙 gUSD supply: ${state.totalSupplyGusd.toFixed(2)}`,
      ]
      if (pos) {
        lines.push(
          `🔒 demo position: ${pos.collateralEth} ETH collateral / ${pos.debtGusd.toFixed(2)} gUSD debt`,
          `❤️ health factor: ${pos.healthFactor === null ? '∞ (debt-free)' : pos.healthFactor.toFixed(2)} → ${pos.liquidatable ? '⚠️ LIQUIDATABLE (anyone can call liquidate)' : '✅ healthy'}`,
        )
      }
      lines.push(`Live gauge: ${origin}/world · rules: mint gate 150% MCR, liquidation below HF 1 (close factor 50%, bonus 10%).`)
      return toolText(id, lines.join('\n'))
    }

    case 'quote_credit_line': {
      const agents = await db.select().from(agent).where(eq(agent.userId, auth.userId))
      const wantedId = args.agent_id ? String(args.agent_id) : null
      const wanted = args.agent_name ? String(args.agent_name) : null
      const target = wantedId
        ? agents.find((a) => a.id === wantedId)
        : wanted
          ? agents.find((a) => a.name.toLowerCase() === wanted.toLowerCase())
          : agents.find((a) => a.smartAccountAddress)
      if (!target) return toolText(id, 'No matching agent with a wallet — create_worker_agent (and earn or mint_test_usdc) first.', true)
      if (!target.smartAccountAddress) return toolText(id, `${target.name} has no wallet yet — it gets one on first funding/claim.`, true)
      const { usdcBalanceOf } = await import('@/lib/onchain/treasury')
      const balance = await usdcBalanceOf(target.smartAccountAddress as `0x${string}`)
      const { maxDebtUsd, healthFactor } = await import('@/lib/mini-vault')
      const pos = { collateralUnits: balance, debtUsd: 0 }
      const maxDebt = maxDebtUsd(pos, 1)
      const hfAtMax = maxDebt > 0 ? healthFactor({ ...pos, debtUsd: maxDebt }, 1) : null
      return toolText(
        id,
        `${target.name} has earned ${balance.toFixed(2)} test USDC on-chain.\n` +
          `As MiniVault collateral (at $1, 150% MCR) that would open a stable credit line of $${maxDebt.toFixed(2)}` +
          (hfAtMax ? ` (health factor ${hfAtMax.toFixed(2)} if fully drawn)` : '') +
          `.\nPreview only — testnet, nothing is escrowed or drawn.`,
      )
    }

    case 'get_work_proof': {
      const jobNo = Number(args.job_id)
      if (!Number.isInteger(jobNo) || jobNo < 0) return toolText(id, 'job_id must be a job number.', true)
      const { getLatestProofForJob } = await import('@/lib/work-proof-store')
      const stored = await getLatestProofForJob(`#${jobNo}`)
      if (!stored) return toolText(id, `No proof recorded for job #${jobNo} — proofs are issued when a job passes grading and auto-settles.`)
      const { verifyWorkProof } = await import('@/lib/attestation')
      const v = await verifyWorkProof(stored.proof, stored.signature as `0x${string}`, stored.attester as `0x${string}`)
      return toolText(
        id,
        `📜 Proof of Authorship & Grade — job #${jobNo}\n` +
          `kind: ${stored.proof.kind} · grader: ${stored.proof.grader} · verdict: ${stored.proof.verdict}\n` +
          `deliverable fingerprint (keccak256): ${stored.proof.contentHash}\n` +
          `attested by: ${stored.attester} → signature ${v.valid ? 'VALID ✅ (trusted oracle)' : 'INVALID ⚠️'}\n` +
          (stored.cid ? `content id: ipfs://${stored.cid}\n` : '') +
          `certificate: ${origin}/proof/${stored.id}`,
      )
    }

    case 'market_price': {
      const { observedPrices } = await import('@/lib/market-price-read')
      const { priceHint } = await import('@/lib/market-price')
      const stats = await observedPrices()
      if (stats.length === 0) {
        return toolText(id, 'No jobs have settled on this market yet, so there is no going rate to quote. You would be setting the first price.')
      }
      const lines = stats.map((st) => `• ${st.jobClass} — ${priceHint(st)}`)
      return toolText(
        id,
        `Observed clearing prices (real completed jobs only — unclaimed postings are asking prices, not trades):\n\n${lines.join('\n')}\n\n` +
          'Pricing a job below the median means waiting longer for a worker; a rising-price plan (price_ceiling_usd on post_repo_job) ' +
          'lets the market find the number instead of you guessing it.',
      )
    }

    case 'github_status': {
      const { githubConnectionFor } = await import('@/lib/github-identity')
      const conn = await githubConnectionFor(auth.userId)
      if (!conn.loginEnabled) {
        return toolText(id, 'This deployment has no GitHub App configured, so repo jobs are unavailable here.', true)
      }
      const connectUrl = `${origin}/api/github/oauth/start?next=/jobs`
      if (!conn.connected) {
        return toolText(
          id,
          'Your Ledgermind account is not linked to GitHub yet.\n\n' +
            `Link it here (opens in a browser, one click): ${connectUrl}\n\n` +
            'Once linked I can list your repositories and post jobs against them without you typing owner/name.',
        )
      }
      if (conn.error) {
        return toolText(id, `Connected as ${conn.login}, but: ${conn.error}\nReconnect: ${connectUrl}`, true)
      }
      if (conn.repos.length === 0) {
        return toolText(
          id,
          `Connected as ${conn.login}, but the Ledgermind GitHub App is not installed on any of your repositories.\n\n` +
            `Install it on the repo you want worked: ${conn.installUrl}\n` +
            'The App is what opens the pull request from a worker\'s diff — without it a job cannot be delivered.',
        )
      }
      const list = conn.repos
        .slice(0, 50)
        .map((r) => `  ${r.fullName}${r.private ? ' (private)' : ''} — default branch ${r.defaultBranch}`)
        .join('\n')
      return toolText(
        id,
        `Connected as ${conn.login}. ${conn.repos.length} repositor${conn.repos.length === 1 ? 'y is' : 'ies are'} ready for repo jobs:\n\n${list}\n\n` +
          `Post one with post_repo_job. Install on more: ${conn.installUrl}`,
      )
    }

    case 'repo_job_status': {
      const { jobSpec } = await import('@/lib/db/schema')
      const mine = await db.select().from(agent).where(eq(agent.userId, auth.userId))
      const myIds = new Set(mine.map((a) => a.id))
      if (myIds.size === 0) return toolText(id, 'No agents on this account yet.')

      const specs = (await db.select().from(jobSpec))
        .filter((sp) => sp.repoFullName && sp.requesterAgentId && myIds.has(sp.requesterAgentId))
        .filter((sp) => (args.job_id === undefined ? true : sp.onchainJobId === Number(args.job_id)))
      if (specs.length === 0) {
        return toolText(id, args.job_id === undefined ? 'You have no GitHub repo jobs yet — post one with post_repo_job.' : `No repo job #${args.job_id} on this account.`)
      }

      const { readJobs } = await import('@/lib/onchain/labor')
      const chain = await readJobs().catch(() => [])
      const statusById = new Map(chain.map((j) => [j.id, j.status]))

      const lines = specs.map((sp) => {
        const onchain = sp.onchainJobId === null ? 'not posted' : (statusById.get(sp.onchainJobId) ?? 'unknown')
        const pr = sp.prNumber ? `https://github.com/${sp.repoFullName}/pull/${sp.prNumber}` : null
        const ci =
          sp.ciStatus === 'success'
            ? 'CI passed'
            : sp.ciStatus === 'failure'
              ? 'CI FAILED'
              : sp.ciStatus === 'pending'
                ? 'CI running'
                : sp.ciStatus === 'merged'
                  ? 'merged (CI result predates this record)' // legacy rows: the merge used to overwrite the CI outcome
                  : 'no CI result yet'
        return [
          `#${sp.onchainJobId ?? '?'} ${sp.title}`,
          `   repo    ${sp.repoFullName} @ ${sp.baseBranch ?? 'default'}`,
          `   escrow  ${onchain}`,
          pr ? `   PR      ${pr} — ${ci}` : '   PR      not opened yet (no diff submitted, or the diff did not apply)',
        ].join('\n')
      })
      return toolText(
        id,
        `${lines.join('\n\n')}\n\nMerging a pull request is what releases its escrow — CI passing alone never moves money.`,
      )
    }

    case 'check_repo_access': {
      const repo = String(args.repo ?? '').trim()
      const { checkRepoAccess } = await import('@/app/actions/repo-jobs')
      const access = await checkRepoAccess(repo)
      return toolText(
        id,
        access.ok
          ? `${access.reason}\nYou can post a repo job here with post_repo_job.`
          : `Not usable yet: ${access.reason}\n\nInstall the Ledgermind GitHub App on ${repo} (the repo owner does this once) and try again.`,
        !access.ok,
      )
    }

    case 'post_repo_job': {
      const repo = String(args.repo ?? '').trim()
      const bounty = Number(args.bounty_usd)
      if (!repo || !Number.isFinite(bounty) || bounty <= 0) return toolText(id, 'repo and a positive bounty_usd are required.', true)
      const agents = await db.select().from(agent).where(eq(agent.userId, auth.userId))
      const wantedId = args.agent_id ? String(args.agent_id) : null
      const wanted = args.agent_name ? String(args.agent_name) : null
      const requester = wantedId
        ? agents.find((a) => a.id === wantedId)
        : wanted
          ? agents.find((a) => a.name.toLowerCase() === wanted.toLowerCase())
          : agents.find((a) => a.smartAccountAddress)
      if (!requester) return toolText(id, 'No provisioned agent to escrow the bounty — create_worker_agent adds one.', true)

      try {
        // The agent was just proven to belong to auth.userId above, so the
        // authorization this call requires is already established. Calling the
        // server ACTION here would fail every time: it re-checks getSession(),
        // and an MCP request carries a bearer token, never a browser session.
        const { postRepoJob } = await import('@/lib/repo-job-post')
        const res = await postRepoJob({
          requesterAgentId: requester.id,
          repoFullName: repo,
          baseBranch: args.base_branch ? String(args.base_branch) : undefined,
          title: String(args.title ?? ''),
          brief: String(args.brief ?? ''),
          issueUrl: args.issue_url ? String(args.issue_url) : undefined,
          criteria: args.criteria ? String(args.criteria) : undefined,
          bountyUsd: bounty,
          pricing:
            args.price_ceiling_usd === undefined
              ? null
              : {
                  ceilingUsd: Number(args.price_ceiling_usd),
                  stepUsd: args.price_step_usd === undefined ? undefined : Number(args.price_step_usd),
                  stepMinutes: args.price_step_minutes === undefined ? undefined : Number(args.price_step_minutes),
                },
        })
        return toolText(
          id,
          `Posted a GitHub job on ${res.repoFullName} (base ${res.baseBranch}), $${bounty} escrowed by ${requester.name}.\n\n` +
            'A worker will submit a unified diff; the platform opens the pull request from it and your own CI grades it. ' +
            'Merging the PR pays the worker; closing it unmerged refunds you and reposts the job.' +
            (res.pricing ? `\n\nRising price: if nobody claims it, the bounty steps up $${res.pricing.stepUsd} every ${res.pricing.stepMinutes}m to a ceiling of $${res.pricing.ceilingUsd}. The first claim sets the clearing price.` : ''),
        )
      } catch (error) {
        return toolText(id, error instanceof Error ? error.message : String(error), true)
      }
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

    case 'connect_mcp_worker': {
      const serverUrl = String(args.server_url ?? '').trim()
      const toolName = String(args.tool_name ?? '').trim()
      const authHeader = args.auth_header ? String(args.auth_header).trim() : undefined
      if (!/^https:\/\//.test(serverUrl)) return toolText(id, 'server_url must start with https://', true)
      if (!toolName) return toolText(id, 'tool_name is required — the tool on that server that does the work.', true)

      const agents = await db.select().from(agent).where(eq(agent.userId, auth.userId))
      const wantedId = args.agent_id ? String(args.agent_id) : null
      const wanted = args.agent_name ? String(args.agent_name) : null
      const target = wantedId
        ? agents.find((a) => a.id === wantedId)
        : wanted
          ? agents.find((a) => a.name.toLowerCase() === wanted.toLowerCase())
          : agents.find((a) => a.smartAccountAddress) ?? agents[0]
      if (!target) {
        return toolText(id, wantedId ? `No agent with id "${wantedId}".` : wanted ? `No agent named "${wanted}".` : 'No agents yet — create one with create_worker_agent first.', true)
      }

      // Best-effort capability probe so the matcher routes it the right jobs.
      let capabilities: string[] | undefined
      try {
        const { probeMcpTool } = await import('@/lib/mcp-client')
        const tool = await probeMcpTool({ serverUrl, toolName, authHeader })
        if (tool) {
          const { inferDeliverableKind, normalizeCapabilities } = await import('@/lib/artifacts')
          capabilities = normalizeCapabilities([inferDeliverableKind(tool.name, tool.description ?? undefined)])
        }
      } catch (e) {
        console.error('[mcp] connect_mcp_worker probe failed (non-fatal):', e)
      }

      const { generateWebhookSecret, encryptWebhookSecret } = await import('@/lib/webhook')
      const { encryptSecret } = await import('@/lib/crypto')
      await db
        .update(agent)
        .set({
          runtimeType: 'mcp',
          mcpServerUrl: serverUrl,
          mcpToolName: toolName,
          mcpAuthHeaderEnc: authHeader ? encryptSecret(authHeader) : null,
          webhookSecretEnc: encryptWebhookSecret(generateWebhookSecret()),
          ...(capabilities ? { capabilities } : {}),
          updatedAt: new Date(),
        })
        .where(eq(agent.id, target.id))

      return toolText(
        id,
        `${target.name} is now an MCP worker → ${toolName} @ ${serverUrl}` +
          (capabilities ? ` (detected capabilities: ${capabilities.join(', ')})` : ' (capability probe pending — defaults to text)') +
          `. When it's dispatched a job the platform calls that server and grades the result. ` +
          `Call set_auto_mine to have it claim jobs on its own.`,
      )
    }

    case 'set_auto_mine': {
      const enabled = args.enabled === undefined ? true : Boolean(args.enabled)
      const agents = await db.select().from(agent).where(eq(agent.userId, auth.userId))
      const wantedId = args.agent_id ? String(args.agent_id) : null
      const wanted = args.agent_name ? String(args.agent_name) : null
      const target = wantedId
        ? agents.find((a) => a.id === wantedId)
        : wanted
          ? agents.find((a) => a.name.toLowerCase() === wanted.toLowerCase())
          : agents.find((a) => a.smartAccountAddress) ?? agents[0]
      if (!target) {
        return toolText(id, wantedId ? `No agent with id "${wantedId}".` : wanted ? `No agent named "${wanted}".` : 'No agents yet — create one with create_worker_agent first.', true)
      }
      await db.update(agent).set({ autoMine: enabled, updatedAt: new Date() }).where(eq(agent.id, target.id))

      // Kick a sweep now so cloud/mcp workers start claiming immediately
      // instead of waiting for someone to open the Jobs page.
      if (enabled) {
        after(async () => {
          const { tickCloudAutoMineAgents } = await import('@/lib/auto-mine')
          await tickCloudAutoMineAgents(`${origin}/api/runtime/callback`).catch(() => {})
        })
      }

      const runtimeNote =
        target.runtimeType === 'cloud' || target.runtimeType === 'mcp'
          ? ` It runs off this chat (${target.runtimeType}), so it will now claim and complete jobs on its own.`
          : target.runtimeType === 'local'
            ? ' Its local worker process claims jobs on its own poll loop.'
            : ' Note: this agent only works inside this conversation, so auto-mine has no runtime to drive it — connect a cloud API key or an MCP worker (connect_mcp_worker) for hands-off mining.'
      return toolText(id, `Auto-mine ${enabled ? 'ON' : 'off'} for ${target.name}.${enabled ? runtimeNote : ''}`)
    }

    case 'browse_capabilities': {
      const limit = Math.max(1, Math.min(Number(args.limit ?? 15) || 15, 40))
      const { listClawhubSkills } = await import('@/lib/clawhub')
      const skills = await listClawhubSkills({ limit }).catch(() => [])
      if (skills.length === 0) return toolText(id, 'No capabilities listed right now (directory unavailable or empty).')
      const lines = skills.map((s) => {
        const topics = s.topics?.length ? ` [${s.topics.slice(0, 4).join(', ')}]` : ''
        const stats = s.installs || s.stars ? ` (${s.installs} installs · ${s.stars}★)` : ''
        return `• ${s.name}${topics}${s.summary ? ` — ${s.summary.slice(0, 120)}` : ''}${stats}\n  ${s.url}`
      })
      return toolText(id, `Hireable capabilities (ClawHub):\n${lines.join('\n')}\n\nWire one in as a worker with connect_mcp_worker.`)
    }

    case 'scenarios': {
      const { listScenarios, getScenario } = await import('@/lib/scenarios')
      const wanted = args.scenario ? String(args.scenario).trim() : ''
      if (!wanted) {
        const list = listScenarios()
        const lines = list.map((s) => `• ${s.slug} — ${s.title} (~${s.minutes} min)\n  ${s.summary}`)
        return toolText(
          id,
          `Guided walkthroughs you can run right here. Call scenarios again with scenario="<slug>" for the full ` +
            `steps, then drive it for the user with the other tools.\n\n${lines.join('\n')}\n\n` +
            `Full versions also live at ${origin}/examples.`,
        )
      }
      const found = getScenario(wanted) ?? getScenario(wanted.replace(/\s+/g, '-').toLowerCase())
      if (!found) {
        const slugs = listScenarios().map((s) => s.slug).join(', ')
        return toolText(id, `No scenario "${wanted}". Available: ${slugs}. Call scenarios with no arguments to see summaries.`, true)
      }
      return toolText(
        id,
        `${found.body}\n\n---\nNow run this for the user step by step with the relevant tools. Confirm each ` +
          `money-moving step (confirm_delegation, etc.) before calling it. Full page: ${origin}/examples/${found.slug}`,
      )
    }

    case 'governance': {
      const { govSummary, listProposals, listPendingReviews } = await import('@/lib/governance')
      const [summary, proposals, reviews] = await Promise.all([
        govSummary(auth.userId),
        listProposals(auth.userId, 10),
        listPendingReviews(auth.userId),
      ])
      const head = `$LEDGER — balance ${summary.balance.toFixed(1)}, locked ${summary.locked.toFixed(1)}, voting power ${summary.votingPower.toFixed(1)} (earned ${summary.totalEarned.toFixed(1)} total).`
      const open = proposals.filter((p) => p.open)
      const propLines = open.length
        ? open.map((p) => `- ${p.id} "${p.title}" — For ${p.tally.for.toFixed(1)} / Against ${p.tally.against.toFixed(1)} / Abstain ${p.tally.abstain.toFixed(1)} · closes ${new Date(p.closesAt).toISOString().slice(0, 10)}${p.yourVote ? ` · you voted ${p.yourVote}` : ''}`).join('\n')
        : '(no open proposals)'
      const reviewLine = reviews.length
        ? `\n\n⚠ ${reviews.length} delegate recommendation(s) need your review (low confidence or minority-impact) — resolve them on /governance.`
        : ''
      return toolText(id, `${head}\n\nOpen proposals:\n${propLines}${reviewLine}\n\nVote with the vote tool. Earn $LEDGER by completing jobs; lock it on the /governance page for power.`)
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
