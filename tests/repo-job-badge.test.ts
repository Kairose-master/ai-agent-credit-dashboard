import { describe, expect, it } from 'vitest'
import { verificationBadge, verificationBadgeLines } from '@/lib/repo-job-badge'

const base = {
  repoFullName: 'acme/widgets',
  baseBranch: 'main',
  diff: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n',
  onchainJobId: 42,
  ciStatus: null as string | null,
  workerName: null as string | null,
}

describe('verificationBadgeLines — no fake positives', () => {
  it('reports escrow good, CI not-yet-reported, and diff applied at open time', () => {
    const lines = verificationBadgeLines(base)
    const byLabel = Object.fromEntries(lines.map((l) => [l.label, l]))
    expect(byLabel.Escrow.tone).toBe('good')
    expect(byLabel.Escrow.value).toContain('job #42')
    expect(byLabel.CI.tone).toBe('warn')
    expect(byLabel.CI.value).toContain('not yet reported')
    expect(byLabel.Diff.tone).toBe('good')
    expect(byLabel.Diff.value).toContain('acme/widgets@main')
  })

  it('never renders CI as passed before a verdict exists', () => {
    const lines = verificationBadgeLines(base)
    const ci = lines.find((l) => l.label === 'CI')!
    expect(ci.value).not.toMatch(/passed/i)
  })

  it('renders CI success and failure honestly once known', () => {
    const passed = verificationBadgeLines({ ...base, ciStatus: 'success' })
    const ci = passed.find((l) => l.label === 'CI')!
    expect(ci.tone).toBe('good')
    expect(ci.value).toContain('passed')

    const failed = verificationBadgeLines({ ...base, ciStatus: 'failure' })
    const ciFail = failed.find((l) => l.label === 'CI')!
    expect(ciFail.tone).toBe('bad')
    expect(ciFail.value).toContain('failed')
  })

  it('warns instead of asserting escrow when no on-chain job id is recorded', () => {
    const lines = verificationBadgeLines({ ...base, onchainJobId: null })
    const escrow = lines.find((l) => l.label === 'Escrow')!
    expect(escrow.tone).toBe('warn')
    expect(escrow.value).not.toMatch(/held on-chain/)
  })

  it('includes the worker line only when a worker name is given', () => {
    expect(verificationBadgeLines(base).some((l) => l.label === 'Worked by')).toBe(false)
    const withWorker = verificationBadgeLines({ ...base, workerName: 'foreman-7' })
    const worked = withWorker.find((l) => l.label === 'Worked by')!
    expect(worked.value).toBe('foreman-7')
    expect(worked.tone).toBe('plain')
  })

  it('hashes the actual diff content, not a placeholder', () => {
    const a = verificationBadgeLines(base)
    const b = verificationBadgeLines({ ...base, diff: base.diff + '\n' })
    const hashOf = (lines: ReturnType<typeof verificationBadgeLines>) => lines.find((l) => l.label === 'Diff')!.value
    expect(hashOf(a)).not.toBe(hashOf(b))
    expect(hashOf(a)).toMatch(/0x[0-9a-f]{64}/)
  })
})

describe('verificationBadge — full markdown render', () => {
  it('renders a table with icons, the doc link, and no bare quality claim', () => {
    const md = verificationBadge(base)
    expect(md.startsWith('### Verified before you read it')).toBe(true)
    expect(md).toContain('| ✅ Escrow |')
    expect(md).toContain('| ⚠️ CI |')
    expect(md).toContain('| ✅ Diff |')
    expect(md).toContain('docs/github-jobs.md')
    expect(md).toContain('not a claim that the change is good')
  })
})
