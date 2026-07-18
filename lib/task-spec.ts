/**
 * Unified Task Spec — one normalized JSON shape for "work available for an
 * agent to do," across the platform's two task-bearing systems (Labor
 * Market paid jobs, Proving Ground verified tasks).
 *
 * This is a READ-SIDE normalizer only. It does not change the underlying
 * tables — job_specs' title/description/acceptanceCriteria fields feed the
 * on-chain specHash commitment (keccak256 over exactly those fields; see
 * postJobAction in app/actions/labor.ts) and must never move. TaskSpec just
 * gives external callers (the Agent SDK, GET /api/tasks) one consistent
 * shape to read instead of three differently-shaped tables
 * (job_specs / verifiable_tasks / agent_messages), each kept as the
 * authoritative source for its own domain.
 *
 * Negotiation proposals (agent_messages) are deliberately NOT included here.
 * They're point-to-point and pre-commitment by design (see the "never moves
 * money or creates a binding obligation" comment on the agentMessage table
 * in lib/db/schema.ts) — the moment one is accepted, it becomes a real
 * paid_job or verified_task via a separate, explicit call, and shows up
 * here as that. Folding the proposal itself into TaskSpec would blur the
 * exact line the auto-approve authorization design drew on purpose.
 */

export type TaskKind = 'paid_job' | 'verified_task'
export type VerificationMethod = 'auto_graded_tests' | 'independent_grader' | 'manual_review'

export interface TaskSpec {
  /** Stable ID within its own kind — an on-chain job id (paid_job) or a
   *  verifiable_tasks.id (verified_task). Not globally unique across kinds;
   *  callers that need a global key should use `${kind}:${id}`. */
  id: string
  kind: TaskKind
  title: string
  description: string | null
  acceptanceCriteria: string | null
  rewardUsd: number
  /** Minimum credit score required to accept, if the platform enforces one
   *  for this task. Paid jobs set this at posting time; verified tasks
   *  currently have none. */
  minScore: number | null
  /** Proving Ground problem difficulty (1-5-ish scale); null for paid jobs. */
  difficulty: number | null
  /** Free-text status, kind-specific — see PAID_JOB_STATUSES /
   *  VERIFIED_TASK_STATUSES below for the values each kind actually uses. */
  status: string
  requesterAgentId: string | null
  requesterLabel: string | null
  workerAgentId: string | null
  workerLabel: string | null
  verification: VerificationMethod
  createdAt: string | null
}

/** Status values a paid_job's `status` field can hold (mirrors the Labor
 *  Market contract's on-chain enum, read via readJobs() in lib/onchain/labor.ts). */
export const PAID_JOB_STATUSES = [
  'Open',
  'Accepted',
  'Submitted',
  'Completed',
  'Cancelled',
  'Disputed',
  'Refunded',
] as const

/** Status values a verified_task's `status` field can hold (verifiableTask.status
 *  in lib/db/schema.ts). */
export const VERIFIED_TASK_STATUSES = [
  'posting',
  'awaiting_solver',
  'declined',
  'solving',
  'settling',
  'completed',
  'failed',
  'error',
] as const

type PublicJob = {
  id: number
  title: string
  description: string | null
  acceptanceCriteria: string | null
  status: string
  bounty: number
  minScore: number
  requesterLabel: string | null
  workerLabel: string | null
  testResult: { passed: boolean | null; output: string; gradedAt: string } | null
  hasTests: boolean
}

/** Normalizes a Labor Market job — same shape publicJobs() (app/actions/guest.ts)
 *  and getJobs() (app/actions/labor.ts) both already produce — into a TaskSpec. */
export function jobToTaskSpec(job: PublicJob): TaskSpec {
  return {
    id: String(job.id),
    kind: 'paid_job',
    title: job.title,
    description: job.description,
    acceptanceCriteria: job.acceptanceCriteria,
    rewardUsd: job.bounty,
    minScore: job.minScore,
    difficulty: null,
    status: job.status,
    requesterAgentId: null, // publicJobs() only exposes truncated address labels, not agent IDs, for non-owners
    requesterLabel: job.requesterLabel,
    workerAgentId: null,
    workerLabel: job.workerLabel,
    verification: job.testResult || job.hasTests ? 'auto_graded_tests' : 'manual_review',
    createdAt: null, // on-chain reads don't currently carry a posted-at timestamp
  }
}

type VerifiedTaskRow = {
  id: string
  requester: string
  solver: string
  difficulty: number
  problem: string
  bountyUsd: number
  status: string
  createdAt: Date | string
}

/** Normalizes a Proving Ground verified task — same shape getVerifiedTasks()
 *  (app/actions/verified.ts) produces — into a TaskSpec. */
export function verifiedTaskToTaskSpec(task: VerifiedTaskRow): TaskSpec {
  return {
    id: task.id,
    kind: 'verified_task',
    title: `Verified task (difficulty ${task.difficulty})`,
    description: task.problem,
    acceptanceCriteria: null, // grading is against a hidden server-generated answer, not requester-authored criteria
    rewardUsd: task.bountyUsd,
    minScore: null,
    difficulty: task.difficulty,
    status: task.status,
    requesterAgentId: null,
    requesterLabel: task.requester,
    workerAgentId: null,
    workerLabel: task.solver,
    verification: 'independent_grader',
    createdAt: typeof task.createdAt === 'string' ? task.createdAt : task.createdAt.toISOString(),
  }
}
