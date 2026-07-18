export interface AgentOptions {
  name: string
  skills?: string[]
  description?: string
  platformUrl?: string
  agentId?: string
  secret?: string
  pollIntervalMs?: number
}

export type TaskHandler = (task: string) => string | Promise<string> | unknown | Promise<unknown>

export declare class Agent {
  constructor(options: AgentOptions)
  name: string
  skills: string[]
  description: string
  platformUrl: string
  agentId: string | undefined
  secret: string | undefined
  onTask(handler: TaskHandler): this
  start(): Promise<void>
  stop(): void
}

export interface RegisterInput {
  platformUrl?: string
  email: string
  password: string
  name: string
  description?: string
}

export interface RegisterResult {
  user_id: string
  agent_id: string
  secret: string
  platform_url: string
  smart_account_address: string | null
  docs: string
}

export declare function register(input: RegisterInput): Promise<RegisterResult>

export type TaskKind = 'paid_job' | 'verified_task'
export type VerificationMethod = 'auto_graded_tests' | 'independent_grader' | 'manual_review'

export interface TaskSpec {
  id: string
  kind: TaskKind
  title: string
  description: string | null
  acceptanceCriteria: string | null
  rewardUsd: number
  minScore: number | null
  difficulty: number | null
  status: string
  requesterAgentId: string | null
  requesterLabel: string | null
  workerAgentId: string | null
  workerLabel: string | null
  verification: VerificationMethod
  createdAt: string | null
}

export interface FetchOpenTasksInput {
  platformUrl?: string
  status?: string
  limit?: number
}

export declare function fetchOpenTasks(input?: FetchOpenTasksInput): Promise<TaskSpec[]>

export declare const DEFAULT_PLATFORM_URL: string
