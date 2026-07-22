/**
 * Collab DSL round-trip + shape tests. The DSL is a readable layer over the
 * JSON graph; these pin that it serializes the structure faithfully and parses
 * back to the same graph (for the fields it carries).
 */
import { describe, it, expect } from 'vitest'
import { graphToDsl, dslToGraph, type CollabPlan } from '@/lib/collab-dsl'

const PLAN: CollabPlan = {
  task: 'Eco tumbler brand kit',
  budgetUsd: 24,
  subtasks: [
    {
      title: 'Design the logo',
      description: 'Produce a minimalist flat-vector logo, earthy palette.',
      acceptanceCriteria: 'A single image, no text, earthy tones.',
      bountyUsd: 10,
      deliverableKind: 'image',
      testCode: null,
    },
    {
      title: 'Write taglines',
      description: 'Write 3 candidate taglines under 6 words each.',
      acceptanceCriteria: 'Three distinct taglines listed.',
      bountyUsd: 4,
      deliverableKind: 'text',
      testCode: null,
    },
    {
      title: 'Record the intro',
      description: 'Record a 15s spoken brand intro.',
      acceptanceCriteria: 'Clear speech matching the script.',
      bountyUsd: 10,
      deliverableKind: 'audio',
      testCode: null,
      dependsOn: ['Design the logo', 'Write taglines'],
    },
  ],
}

describe('collab DSL', () => {
  it('serializes the plan header and a handoff (needs)', () => {
    const dsl = graphToDsl(PLAN)
    expect(dsl).toContain('plan "Eco tumbler brand kit" budget $24')
    expect(dsl).toMatch(/audio \$10 "Record the intro" needs design-the-logo, write-taglines/)
  })

  it('round-trips the structural fields and dependencies', () => {
    const back = dslToGraph(graphToDsl(PLAN))
    expect(back.task).toBe(PLAN.task)
    expect(back.budgetUsd).toBe(24)
    expect(back.subtasks.map((s) => s.title)).toEqual([
      'Design the logo',
      'Write taglines',
      'Record the intro',
    ])
    const voice = back.subtasks.find((s) => s.title === 'Record the intro')!
    expect(voice.deliverableKind).toBe('audio')
    expect(voice.bountyUsd).toBe(10)
    // dependencies survive the id<->title mapping
    expect(voice.dependsOn).toEqual(['Design the logo', 'Write taglines'])
  })

  it('compact mode drops the do/ok brief, keeps the structure', () => {
    const compact = graphToDsl(PLAN, { compact: true })
    expect(compact).not.toContain('  do ')
    expect(compact).not.toContain('  ok ')
    expect(compact).toContain('needs design-the-logo, write-taglines')
  })

  it('represents an integration check line', () => {
    const withCheck: CollabPlan = {
      ...PLAN,
      subtasks: [
        ...PLAN.subtasks,
        {
          title: 'Everything assembles',
          description: '',
          acceptanceCriteria: 'The parts form one coherent kit.',
          bountyUsd: 0,
          deliverableKind: 'text',
          testCode: 'assert True',
          isIntegration: true,
        },
      ],
    }
    const dsl = graphToDsl(withCheck)
    expect(dsl).toContain('check "Everything assembles"')
    const back = dslToGraph(dsl)
    expect(back.subtasks.find((s) => s.isIntegration)?.isIntegration).toBe(true)
  })

  it('collapses multi-line descriptions to one DSL line', () => {
    const multi: CollabPlan = {
      task: 'x',
      budgetUsd: 5,
      subtasks: [
        { title: 'A', description: 'line one\nline two', acceptanceCriteria: 'ok', bountyUsd: 5, deliverableKind: 'text', testCode: null },
      ],
    }
    const dsl = graphToDsl(multi)
    expect(dsl).toContain('do line one line two')
  })
})
