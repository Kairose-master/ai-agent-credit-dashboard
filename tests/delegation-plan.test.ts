/**
 * Planner-output guardrail tests. These checks are what stand between a
 * misbehaving/jailbroken planner LLM and real escrowed money, so they get
 * pinned: count bounds, per-subtask validation, and the budget ceiling.
 */
import { describe, it, expect } from 'vitest'
import { parsePlannerOutput, MAX_SUBTASKS } from '@/lib/delegation'

const goodSubtask = (over: Record<string, unknown> = {}) => ({
  title: 'Write flatten(xs)',
  description: 'Write a self-contained Python function flatten(xs)…',
  acceptanceCriteria: 'A function named flatten that flattens one level.',
  bountyUsd: 5,
  ...over,
})

describe('parsePlannerOutput', () => {
  it('parses a valid plan and normalizes bounties to cents', () => {
    const out = parsePlannerOutput(JSON.stringify([goodSubtask({ bountyUsd: 4.999 })]), 15)
    expect(out).toHaveLength(1)
    expect(out[0].bountyUsd).toBe(5)
    expect(out[0].testCode).toBeNull()
  })

  it('strips markdown code fences before parsing', () => {
    const fenced = '```json\n' + JSON.stringify([goodSubtask()]) + '\n```'
    expect(parsePlannerOutput(fenced, 15)).toHaveLength(1)
  })

  it('keeps testCode when present and non-empty', () => {
    const out = parsePlannerOutput(JSON.stringify([goodSubtask({ testCode: 'assert flatten([[1]]) == [1]' })]), 15)
    expect(out[0].testCode).toContain('assert')
  })

  it('rejects unparseable output', () => {
    expect(() => parsePlannerOutput('sure! here is the plan:', 15)).toThrow(/unparseable/)
  })

  it('rejects an empty plan and an oversized plan', () => {
    expect(() => parsePlannerOutput('[]', 15)).toThrow()
    const tooMany = Array.from({ length: MAX_SUBTASKS + 1 }, () => goodSubtask({ bountyUsd: 1 }))
    expect(() => parsePlannerOutput(JSON.stringify(tooMany), 100)).toThrow()
  })

  it('rejects subtasks missing required fields', () => {
    expect(() => parsePlannerOutput(JSON.stringify([goodSubtask({ title: '' })]), 15)).toThrow(/missing/)
    expect(() => parsePlannerOutput(JSON.stringify([goodSubtask({ acceptanceCriteria: 'short' })]), 15)).toThrow(/missing/)
  })

  it('rejects invalid bounties', () => {
    expect(() => parsePlannerOutput(JSON.stringify([goodSubtask({ bountyUsd: 0 })]), 15)).toThrow(/invalid bounty/)
    expect(() => parsePlannerOutput(JSON.stringify([goodSubtask({ bountyUsd: 'free' })]), 15)).toThrow(/invalid bounty/)
  })

  it('rejects a plan whose bounties exceed the budget — the hard money guard', () => {
    const plan = [goodSubtask({ bountyUsd: 8 }), goodSubtask({ bountyUsd: 8 })]
    expect(() => parsePlannerOutput(JSON.stringify(plan), 15)).toThrow(/exceeded the budget/)
  })

  it('accepts a plan exactly at budget', () => {
    const plan = [goodSubtask({ bountyUsd: 7.5 }), goodSubtask({ bountyUsd: 7.5 })]
    expect(parsePlannerOutput(JSON.stringify(plan), 15)).toHaveLength(2)
  })
})
