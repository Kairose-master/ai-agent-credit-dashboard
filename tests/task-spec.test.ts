/**
 * Unified Task Spec normalizer tests. The `verification` cases pin a real
 * production bug: an Open job with acceptance tests attached (but not yet
 * graded, so testResult was still null) was mislabeled manual_review on
 * the public /api/tasks feed.
 */
import { describe, it, expect } from 'vitest'
import { jobToTaskSpec, verifiedTaskToTaskSpec, PAID_JOB_STATUSES } from '@/lib/task-spec'

const baseJob = {
  id: 45,
  title: 'Implement count_vowels(s)',
  description: 'Write a Python function…',
  acceptanceCriteria: '- Passes the attached tests exactly',
  status: 'Open',
  bounty: 15,
  minScore: 200,
  requesterLabel: '0xcfd3…Cf4d',
  workerLabel: null,
  testResult: null,
  hasTests: false,
}

describe('jobToTaskSpec verification', () => {
  it('labels a graded job auto_graded_tests', () => {
    const spec = jobToTaskSpec({
      ...baseJob,
      testResult: { passed: true, output: 'ok', gradedAt: '2026-01-01T00:00:00Z' },
    })
    expect(spec.verification).toBe('auto_graded_tests')
  })

  it('labels an UNGRADED job with attached tests auto_graded_tests (regression: was manual_review)', () => {
    const spec = jobToTaskSpec({ ...baseJob, testResult: null, hasTests: true })
    expect(spec.verification).toBe('auto_graded_tests')
  })

  it('labels a job with no tests manual_review', () => {
    const spec = jobToTaskSpec({ ...baseJob, testResult: null, hasTests: false })
    expect(spec.verification).toBe('manual_review')
  })

  it('maps core fields faithfully', () => {
    const spec = jobToTaskSpec(baseJob)
    expect(spec).toMatchObject({
      id: '45',
      kind: 'paid_job',
      rewardUsd: 15,
      minScore: 200,
      status: 'Open',
      requesterLabel: '0xcfd3…Cf4d',
    })
    expect(PAID_JOB_STATUSES).toContain(spec.status)
  })
})

describe('verifiedTaskToTaskSpec', () => {
  it('maps a verified task with independent_grader verification', () => {
    const spec = verifiedTaskToTaskSpec({
      id: 'vt-1',
      requester: 'Research Agent',
      solver: 'Solver Agent',
      difficulty: 3,
      problem: 'Compute the thing.',
      bountyUsd: 12,
      status: 'awaiting_solver',
      createdAt: new Date('2026-01-02T03:04:05Z'),
    })
    expect(spec.kind).toBe('verified_task')
    expect(spec.verification).toBe('independent_grader')
    expect(spec.difficulty).toBe(3)
    expect(spec.createdAt).toBe('2026-01-02T03:04:05.000Z')
  })
})
