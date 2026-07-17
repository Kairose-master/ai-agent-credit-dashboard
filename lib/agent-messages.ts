/**
 * Agent-to-agent negotiation — a structured, machine-readable channel
 * separate from dm_messages (which is free-text, human-to-human). Any
 * registered agent can message any other registered agent (open by
 * design, per the product decision), so this module is where the three
 * things that make "open" safe live: a per-sender rate limit,
 * agent_blocks (self-service, per-recipient), and agent.messagingSuspended
 * (admin-moderated, platform-wide — see the 'agent_messages' permission in
 * lib/admin.ts, for abuse a single recipient's block can't reach). Callers
 * are `app/actions/agent-messages.ts` (owner-driven,
 * from the dashboard) and `app/api/agents/messages/*` (agent-runtime- and
 * BYO-agent-driven, over HTTP) — both funnel through sendAgentMessage()
 * rather than inserting rows directly, so the guardrails can't be skipped
 * from one call site and not the other.
 *
 * Deliberately does NOT move money or create a binding obligation. See the
 * doc comment on the agentMessage table in lib/db/schema.ts.
 */
import { db } from '@/lib/db'
import { agent, agentBlock, agentMessage } from '@/lib/db/schema'
import { and, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'

export const MESSAGE_TYPES = [
  'inquiry',
  'info',
  'job_proposal',
  'job_counter_proposal',
  'job_proposal_accept',
  'job_proposal_reject',
] as const
export type AgentMessageType = (typeof MESSAGE_TYPES)[number]

const BODY_MAX_LENGTH = 4000
// Generous for genuine back-and-forth negotiation (a proposal/counter/accept
// chain is a handful of messages), tight enough to bound a spam loop — an
// agent stuck in a "propose→reject→propose" cycle hits this within the hour
// rather than running unbounded.
const RATE_LIMIT_PER_HOUR = 60

export type SendAgentMessageInput = {
  fromAgentId: string
  toAgentId: string
  type: AgentMessageType
  body: string
  payload?: Record<string, unknown>
}

export async function sendAgentMessage(input: SendAgentMessageInput) {
  if (input.fromAgentId === input.toAgentId) throw new Error('An agent cannot message itself')
  if (!MESSAGE_TYPES.includes(input.type)) throw new Error(`Unknown message type: ${input.type}`)

  const trimmedBody = input.body.trim()
  if (!trimmedBody) throw new Error('Message is empty')
  if (trimmedBody.length > BODY_MAX_LENGTH) throw new Error('Message too long')

  const [fromAgent] = await db
    .select({ messagingSuspended: agent.messagingSuspended, reason: agent.messagingSuspendedReason })
    .from(agent)
    .where(eq(agent.id, input.fromAgentId))
  if (fromAgent?.messagingSuspended) {
    throw new Error(
      fromAgent.reason
        ? `Agent messaging suspended by platform moderation: ${fromAgent.reason}`
        : 'Agent messaging suspended by platform moderation',
    )
  }

  const [toAgent] = await db.select({ id: agent.id }).from(agent).where(eq(agent.id, input.toAgentId))
  if (!toAgent) throw new Error('Recipient agent not found')

  const [blocked] = await db
    .select()
    .from(agentBlock)
    .where(and(eq(agentBlock.blockerAgentId, input.toAgentId), eq(agentBlock.blockedAgentId, input.fromAgentId)))
  if (blocked) throw new Error('Recipient is not accepting messages from this agent')

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const recentFromSender = await db
    .select({ id: agentMessage.id })
    .from(agentMessage)
    .where(and(eq(agentMessage.fromAgentId, input.fromAgentId), gt(agentMessage.createdAt, hourAgo)))
  if (recentFromSender.length >= RATE_LIMIT_PER_HOUR) {
    throw new Error(`Rate limit: at most ${RATE_LIMIT_PER_HOUR} agent messages per hour`)
  }

  const id = nanoid()
  await db.insert(agentMessage).values({
    id,
    fromAgentId: input.fromAgentId,
    toAgentId: input.toAgentId,
    type: input.type,
    body: trimmedBody,
    payload: input.payload ?? {},
  })
  return { id }
}

/** Every message either sent or received by this agent, newest first —
 *  used to derive both the per-counterpart conversation list and an inbox. */
export async function listAgentMessages(agentId: string) {
  return db
    .select()
    .from(agentMessage)
    .where(or(eq(agentMessage.fromAgentId, agentId), eq(agentMessage.toAgentId, agentId)))
    .orderBy(desc(agentMessage.createdAt))
}

export async function markAgentMessagesRead(agentId: string, counterpartAgentId: string) {
  await db
    .update(agentMessage)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(agentMessage.toAgentId, agentId),
        eq(agentMessage.fromAgentId, counterpartAgentId),
      ),
    )
}

/** Unread messages addressed to this agent, oldest first — the shape a
 *  poller (BYO worker, or the platform runtime's check_agent_inbox tool)
 *  actually wants: work through them in order, then mark read. */
export async function pollAgentInbox(agentId: string, limit = 20) {
  const rows = await db
    .select()
    .from(agentMessage)
    .where(and(eq(agentMessage.toAgentId, agentId), isNull(agentMessage.readAt)))
    .orderBy(agentMessage.createdAt)
    .limit(limit)
  return rows
}

/** Marks exactly these message ids read — used after a poll fetch, as
 *  opposed to markAgentMessagesRead's "whole conversation" semantics for
 *  the dashboard conversation view. */
export async function markMessagesReadByIds(ids: string[]) {
  if (ids.length === 0) return
  await db.update(agentMessage).set({ readAt: new Date() }).where(inArray(agentMessage.id, ids))
}
