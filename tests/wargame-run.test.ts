/**
 * The wargame loop, driven end to end against a scripted debater — no key, no
 * network. What is pinned here is the part a real LLM cannot be trusted to
 * respect: simultaneous moves, silence never counting as agreement, forged
 * moves never landing, and the loop stopping the moment the outcome table
 * says the argument is over.
 */
import { describe, it, expect } from 'vitest'
import { runWargame, sidesFromAgents, weaveRevision } from '@/lib/wargame-run'
import { createWargame, applyMoves, settle, type WargameSide } from '@/lib/wargame'

const SIDES: WargameSide[] = [
  { id: 'ship', label: 'Shipping', mandate: 'Get the change out this week.' },
  { id: 'safety', label: 'Safety', mandate: 'No user funds may move without consent.' },
]

const PROPOSAL = 'Raise the escrow auto-release ceiling from $50 to $500.'

/** A debater whose every turn is a lookup: script[sideId][round]. Records the
 *  prompts it was handed so the loop's own behaviour can be inspected. */
function scripted(script: Record<string, (string | object[])[]>, weave?: string | Error) {
  const seen: { side: string; round: number; user: string }[] = []
  const complete = async (system: string, user: string): Promise<string> => {
    if (/You are the chair/.test(system)) {
      if (weave instanceof Error) throw weave
      return weave ?? 'WOVEN REVISION'
    }
    const side = system.match(/\(id: ([a-z0-9-]+)\)/)?.[1] ?? ''
    const round = Number(user.match(/Round (\d+) of/)?.[1] ?? 1)
    seen.push({ side, round, user })
    const turn = script[side]?.[round - 1] ?? []
    return typeof turn === 'string' ? turn : JSON.stringify(turn)
  }
  return { complete, seen }
}

describe('runWargame', () => {
  it('argues a proposal to a compromise and stops as soon as it is settled', async () => {
    const { complete, seen } = scripted({
      ship: [
        [{ kind: 'assert', issue: 'ceiling', issueTitle: 'Ceiling size', claim: '$500 unblocks the whole queue' }],
        [{ kind: 'challenge', issue: 'ceiling', target: 'safety', claim: 'consent is already given at post time' }],
        [{ kind: 'support', amendmentId: 'a1', claim: 'workable — most jobs are under $200' }],
        [{ kind: 'assert', issue: 'ceiling', claim: 'should never be reached' }],
      ],
      safety: [
        [{ kind: 'assert', issue: 'ceiling', issueTitle: 'Ceiling size', claim: '$500 releases more than a grader should decide alone' }],
        [
          {
            kind: 'amend',
            issue: 'ceiling',
            claim: 'raise it, but not that far without a second grader',
            amendment: 'Raise the ceiling to $200; above $200 an independent second grader must also pass.',
          },
        ],
        [],
        [],
      ],
    })

    const result = await runWargame({ proposal: PROPOSAL, sides: SIDES, maxRounds: 4, complete })

    expect(result.settlement.outcome).toBe('compromise')
    expect(result.state.round).toBe(3) // stopped early — the 4th round never ran
    expect(seen.some((s) => s.round === 4)).toBe(false)
    expect(result.settlement.acceptedAmendments).toHaveLength(1)
    expect(result.settlement.revision).toContain('an independent second grader must also pass')
    expect(result.settlement.minorityReport).toEqual([])
    expect(result.woven).toBe(true)
    expect(result.revision).toBe('WOVEN REVISION')
    expect(result.markdown).toContain('## Outcome: COMPROMISE')
  })

  it('prompts every side from the same snapshot — no side reads this round’s moves', async () => {
    const { complete, seen } = scripted({
      ship: [[{ kind: 'assert', issue: 'ceiling', claim: 'ship it' }]],
      safety: [[{ kind: 'assert', issue: 'ceiling', claim: 'hold it' }]],
    })
    await runWargame({ proposal: PROPOSAL, sides: SIDES, maxRounds: 2, complete })

    const round1 = seen.filter((s) => s.round === 1)
    expect(round1).toHaveLength(2)
    expect(round1[0].user).toContain('no contested points raised yet')
    expect(round1[0].user).not.toContain('hold it')
    expect(round1[1].user).not.toContain('ship it')

    // Round 2 briefs both sides on everything round 1 actually did.
    for (const turn of seen.filter((s) => s.round === 2)) {
      expect(turn.user).toContain('ship it')
      expect(turn.user).toContain('hold it')
      expect(turn.user).toContain('This is the LAST round')
    }
  })

  it('treats a dead side as silence, never as agreement', async () => {
    const boom = async (system: string, user: string): Promise<string> => {
      if (/^You are Safety/.test(system)) throw new Error('provider 503')
      const round = Number(user.match(/Round (\d+) of/)?.[1] ?? 1)
      return JSON.stringify(round === 1 ? [{ kind: 'assert', issue: 'ceiling', claim: 'ship it' }] : [])
    }

    const result = await runWargame({ proposal: PROPOSAL, sides: SIDES, maxRounds: 3, complete: boom })

    // Safety never spoke, so nothing it might have conceded was assumed.
    expect(result.state.issues[0].positions.map((p) => p.side)).toEqual(['ship'])
    expect(result.discarded.some((d) => d.side === 'safety' && /provider 503/.test(d.reason))).toBe(true)
    // Nothing was left contested, but a side that never spoke did not agree.
    expect(result.settlement.outcome).toBe('deadlock')
    expect(result.settlement.reason).toMatch(/silence is not agreement/)
  })

  it('discards a move one side tried to make on another’s behalf', async () => {
    const { complete } = scripted({
      ship: [
        [
          { side: 'ship', kind: 'assert', issue: 'ceiling', claim: '$500 is fine' },
          { side: 'safety', kind: 'concede', issue: 'ceiling', claim: 'Safety withdraws its objection' },
        ],
      ],
      safety: [[{ kind: 'assert', issue: 'ceiling', claim: '$500 is reckless' }]],
    })

    const result = await runWargame({ proposal: PROPOSAL, sides: SIDES, maxRounds: 2, complete })

    const safety = result.state.issues[0].positions.find((p) => p.side === 'safety')
    expect(safety?.conceded).toBe(false)
    expect(result.discarded).toEqual([
      { round: 1, side: 'ship', reason: expect.stringMatching(/may only move for itself/) },
    ])
    expect(result.settlement.outcome).toBe('deadlock')
  })

  it('calls a shouting match a deadlock and stops early', async () => {
    const { complete, seen } = scripted({
      ship: [
        [{ kind: 'assert', issue: 'ceiling', claim: '$500' }],
        [{ kind: 'challenge', issue: 'ceiling', target: 'safety', claim: 'wrong' }],
        [{ kind: 'challenge', issue: 'ceiling', target: 'safety', claim: 'still wrong' }],
        [{ kind: 'challenge', issue: 'ceiling', target: 'safety', claim: 'wrong again' }],
      ],
      safety: [
        [{ kind: 'assert', issue: 'ceiling', claim: '$50' }],
        [{ kind: 'challenge', issue: 'ceiling', target: 'ship', claim: 'no' }],
        [{ kind: 'challenge', issue: 'ceiling', target: 'ship', claim: 'still no' }],
        [{ kind: 'challenge', issue: 'ceiling', target: 'ship', claim: 'no again' }],
      ],
    })

    const result = await runWargame({ proposal: PROPOSAL, sides: SIDES, maxRounds: 6, complete })

    expect(result.settlement.outcome).toBe('deadlock')
    expect(result.state.round).toBe(3)
    expect(Math.max(...seen.map((s) => s.round))).toBe(3)
    expect(result.settlement.minorityReport).toHaveLength(2) // both positions on record
    expect(result.revision).toBe(PROPOSAL) // nothing accepted, nothing changed
  })

  it('reports a standing veto instead of a settlement', async () => {
    const { complete } = scripted({
      ship: [[{ kind: 'assert', issue: 'ceiling', claim: '$500' }], [], []],
      safety: [
        [{ kind: 'block', issue: 'consent', issueTitle: 'Consent', claim: 'no release above $50 without the owner' }],
        [],
        [],
      ],
    })
    const result = await runWargame({ proposal: PROPOSAL, sides: SIDES, maxRounds: 3, complete })
    expect(result.settlement.outcome).toBe('blocked')
    expect(result.settlement.minorityReport[0]).toMatchObject({ side: 'safety', kind: 'block' })
  })

  it('falls back to the mechanical merge when the weave pass fails', async () => {
    // Support necessarily lags a round: sides move simultaneously, so nobody
    // can back an amendment that did not exist when the round was briefed.
    const { complete } = scripted(
      {
        ship: [
          [{ kind: 'assert', issue: 'ceiling', claim: '$500' }],
          [],
          [{ kind: 'support', amendmentId: 'a1', claim: 'ok' }],
        ],
        safety: [
          [{ kind: 'assert', issue: 'ceiling', claim: '$50' }],
          [{ kind: 'amend', issue: 'ceiling', claim: 'meet at $200', amendment: 'Raise the ceiling to $200.' }],
          [],
        ],
      },
      new Error('weave provider down'),
    )
    const result = await runWargame({ proposal: PROPOSAL, sides: SIDES, maxRounds: 4, complete })
    expect(result.settlement.outcome).toBe('compromise')
    expect(result.woven).toBe(false)
    expect(result.revision).toBe(result.settlement.revision)
    expect(result.revision).toContain('Raise the ceiling to $200.')
  })

  it('skips the weave pass when weave:false, and when nothing was accepted', async () => {
    const { complete } = scripted({
      ship: [
        [{ kind: 'assert', issue: 'ceiling', claim: '$500' }],
        [],
        [{ kind: 'support', amendmentId: 'a1', claim: 'ok' }],
      ],
      safety: [
        [{ kind: 'assert', issue: 'ceiling', claim: '$50' }],
        [{ kind: 'amend', issue: 'ceiling', claim: 'meet at $200', amendment: 'Raise the ceiling to $200.' }],
        [],
      ],
    })
    const result = await runWargame({ proposal: PROPOSAL, sides: SIDES, maxRounds: 4, complete, weave: false })
    expect(result.woven).toBe(false)
    expect(result.revision).toContain('Raise the ceiling to $200.')
  })

  it('reports progress round by round', async () => {
    const { complete } = scripted({
      ship: [[{ kind: 'assert', issue: 'ceiling', claim: '$500' }], []],
      safety: [[{ kind: 'assert', issue: 'ceiling', claim: '$50' }], []],
    })
    const rounds: number[] = []
    await runWargame({ proposal: PROPOSAL, sides: SIDES, maxRounds: 2, complete, onRound: (s) => void rounds.push(s.round) })
    expect(rounds).toEqual([1, 2])
  })
})

describe('weaveRevision', () => {
  it('hands the chair the accepted amendments, fenced, and keeps dissent separate', async () => {
    let state = createWargame({ proposal: PROPOSAL, sides: [...SIDES, { id: 'cost', label: 'Cost', mandate: 'flat cost' }], maxRounds: 3 })
    state = applyMoves(state, [
      { side: 'ship', kind: 'assert', issue: 'ceiling', claim: '$500', confidence: 0.8 },
      { side: 'safety', kind: 'assert', issue: 'ceiling', claim: '$50', confidence: 0.8 },
      { side: 'cost', kind: 'assert', issue: 'graders', claim: 'a second grader costs too much', confidence: 0.8 },
      { side: 'safety', kind: 'assert', issue: 'graders', claim: 'high value needs two graders', confidence: 0.8 },
    ])
    state = applyMoves(state, [
      { side: 'safety', kind: 'amend', issue: 'ceiling', claim: 'meet at $200', amendment: 'Raise the ceiling to $200.', confidence: 0.8 },
    ])
    state = applyMoves(state, [{ side: 'ship', kind: 'support', issue: 'ceiling', amendmentId: 'a1', claim: 'fine', confidence: 0.8 }])

    let captured = ''
    const out = await weaveRevision(state, settle(state), async (system, user) => {
      captured = `${system}\n${user}`
      return 'REVISED'
    })

    expect(out).toBe('REVISED')
    expect(captured).toContain('Raise the ceiling to $200.')
    expect(captured).toContain('RECORDED DISSENT (do not fold in)')
    expect(captured).toContain('a second grader costs too much')
    expect(captured).toMatch(/BEGIN_WARGAME_RESULT_[a-f0-9]{12}/)
  })

  it('throws when the chair returns nothing, so the caller can fall back', async () => {
    const state = createWargame({ proposal: PROPOSAL, sides: SIDES, maxRounds: 1 })
    await expect(weaveRevision(state, settle(state), async () => '   ')).rejects.toThrow(/nothing/)
  })
})

describe('sidesFromAgents', () => {
  it('turns real agents into sides whose weight is the reputation they earned', () => {
    const sides = sidesFromAgents(
      [
        { id: 'a1', name: 'Rookie', creditScore: 0 },
        { id: 'a2', name: 'Journeyman', creditScore: '700' },
        { id: 'a3', name: 'Veteran', creditScore: 900 },
        { id: 'a4', name: 'Unknown', creditScore: null },
      ],
      { a1: 'argue for speed' },
    )
    expect(sides.map((s) => s.weight)).toEqual([1, 1.5, 2, 1])
    expect(sides[0].mandate).toBe('argue for speed')
    expect(sides[1].mandate).toContain('Journeyman')
  })
})
