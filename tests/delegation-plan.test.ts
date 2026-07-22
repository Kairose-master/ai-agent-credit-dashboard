/**
 * Planner-output guardrail tests. These checks are what stand between a
 * misbehaving/jailbroken planner LLM and real escrowed money, so they get
 * pinned: count bounds, per-subtask validation, and the budget ceiling.
 */
import { describe, it, expect } from 'vitest'
import { parsePlannerOutput, parseReviewVerdict, MAX_SUBTASKS } from '@/lib/delegation'

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

  // --- dependency graph (dependsOn) — the DAG handoff ---

  const A = goodSubtask({ title: 'Draft the copy', bountyUsd: 4 })
  const B = (over: Record<string, unknown> = {}) =>
    goodSubtask({ title: 'Polish the copy', bountyUsd: 4, ...over })

  it('parses a valid handoff and carries dependsOn through', () => {
    const out = parsePlannerOutput(JSON.stringify([A, B({ dependsOn: ['Draft the copy'] })]), 15)
    expect(out[1].dependsOn).toEqual(['Draft the copy'])
    expect(out[0].dependsOn).toBeUndefined()
  })

  it('dedupes repeated dependency titles', () => {
    const out = parsePlannerOutput(
      JSON.stringify([A, B({ dependsOn: ['Draft the copy', 'Draft the copy'] })]),
      15,
    )
    expect(out[1].dependsOn).toEqual(['Draft the copy'])
  })

  it('rejects a dependency on an unknown subtask', () => {
    expect(() =>
      parsePlannerOutput(JSON.stringify([A, B({ dependsOn: ['Nonexistent'] })]), 15),
    ).toThrow(/unknown subtask/)
  })

  it('rejects a self-dependency', () => {
    expect(() =>
      parsePlannerOutput(JSON.stringify([B({ dependsOn: ['Polish the copy'] })]), 15),
    ).toThrow(/depends on itself/)
  })

  it('rejects a circular dependency', () => {
    const a = goodSubtask({ title: 'A', bountyUsd: 4, dependsOn: ['B'] })
    const b = goodSubtask({ title: 'B', bountyUsd: 4, dependsOn: ['A'] })
    expect(() => parsePlannerOutput(JSON.stringify([a, b]), 15)).toThrow(/circular/)
  })

  // --- peer review (reviewOf) ---

  it('parses a peer review and auto-depends it on its target', () => {
    const out = parsePlannerOutput(
      JSON.stringify([A, B({ title: 'Review the copy', reviewOf: 'Draft the copy' })]),
      15,
    )
    const rev = out.find((s) => s.reviewOf)!
    expect(rev.reviewOf).toBe('Draft the copy')
    expect(rev.dependsOn).toContain('Draft the copy') // review implies dependency
  })

  it('rejects a review of an unknown or self subtask, and a review of a review', () => {
    expect(() =>
      parsePlannerOutput(JSON.stringify([A, B({ title: 'R', reviewOf: 'Nope' })]), 15),
    ).toThrow(/reviews unknown/)
    expect(() =>
      parsePlannerOutput(JSON.stringify([B({ title: 'R', reviewOf: 'R' })]), 15),
    ).toThrow(/reviews itself/)
    const r1 = goodSubtask({ title: 'R1', bountyUsd: 4, reviewOf: 'Draft the copy' })
    const r2 = goodSubtask({ title: 'R2', bountyUsd: 4, reviewOf: 'R1' })
    expect(() => parsePlannerOutput(JSON.stringify([A, r1, r2]), 15)).toThrow(/review another review/)
  })
})

describe('parseReviewVerdict', () => {
  it('reads an explicit approval', () => {
    expect(parseReviewVerdict('APPROVE — reads well').approve).toBe(true)
    expect(parseReviewVerdict('LGTM').approve).toBe(true)
  })
  it('reads a revision request, and REVISE wins over a stray approve word', () => {
    expect(parseReviewVerdict('REVISE: tighten the second sentence').approve).toBe(false)
    expect(parseReviewVerdict('I would approve it, but please REVISE the ending').approve).toBe(false)
  })
  it('treats an unclear verdict as a revision — silence is not approval', () => {
    expect(parseReviewVerdict('hmm, interesting work').approve).toBe(false)
  })
})
