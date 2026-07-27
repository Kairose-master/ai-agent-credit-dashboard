import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/**
 * An EVM address is the same address checksummed or lowercased, and this
 * codebase compared them BOTH ways. Two call sites already lowercased — which
 * is evidence the problem was hit before and fixed locally instead of
 * centrally — while three compared exactly, and each of those is a silent skip
 * on a money path:
 *
 *   stale-claim      can't find the worker    ⇒ escrow frozen forever (§1)
 *   exhausted-refund can't find the requester ⇒ no refund
 *   creditWorkerForJob can't find the worker  ⇒ PAID with no credit event (§8)
 *
 * Whether case was the cause of any currently-stuck job is unproven; an agent
 * row really can be missing. That is why the helper returns a reason instead of
 * undefined — so the next occurrence is answerable from a log line.
 */
describe('address comparisons on money paths', () => {
  const files = ['lib/stale-claim.ts', 'lib/exhausted-refund.ts', 'app/actions/labor.ts']

  for (const f of files) {
    it(`${f} no longer compares smartAccountAddress exactly`, () => {
      // `eq(agent.smartAccountAddress, <onchain address>)` is the bug shape.
      expect(read(f)).not.toMatch(/eq\((?:agent|agentTable)\.smartAccountAddress,\s*(?:job|worker|requester)/)
    })

    it(`${f} routes the lookup through agentByAddress`, () => {
      expect(read(f)).toContain('agentByAddress')
    })
  }

  it('the helper lowercases both sides in SQL', () => {
    const src = read('lib/agent-by-address.ts')
    expect(src).toMatch(/lower\(\$\{agent\.smartAccountAddress\}\)/)
    expect(src).toContain('.toLowerCase()')
  })

  it('the all-zero address is never an agent', () => {
    // job.worker is 0x000… on an unclaimed job; that is not a missing row.
    const src = read('lib/agent-by-address.ts')
    expect(src).toContain("'zero-address'")
    expect(src).toMatch(/\^0x0\+\$/)
  })

  it('a failed lookup carries a reason, so the skip is not silent', () => {
    const src = read('lib/agent-by-address.ts')
    expect(src).toContain("reason: 'zero-address' | 'no-agent-row'")
  })
})

/**
 * The sweep used to `continue` past an unresolvable job with no trace, which
 * is the same invisible limbo as §5: escrow frozen and nothing saying why.
 */
describe('unresolvable jobs are surfaced, not skipped', () => {
  it('stale-claim counts and logs them', () => {
    const src = read('lib/stale-claim.ts')
    expect(src).toContain('unresolvable++')
    expect(src).toMatch(/cannot be recovered — unresolvable/)
    expect(src).toContain('unresolvable: number')
  })

  it('the ops-cycle line shouts when any exist', () => {
    // A count that only appears in a report nobody greps is not surfaced.
    expect(read('lib/ops-cycle.ts')).toContain('UNRESOLVABLE')
  })
})
