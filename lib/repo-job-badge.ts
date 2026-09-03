/**
 * The verification badge on a repo-job pull request (docs/github-jobs.md).
 *
 * A repo-job PR is opened automatically, before the requester's CI has run —
 * so at open time some claims are already true (escrow happened at posting;
 * the diff applied cleanly to reach this point) and some are simply not yet
 * known (CI has not reported). The badge says exactly which is which. Never
 * render "passed" for a check that has not run: an unrun or unreported check
 * renders as an explicit warn-toned line, never silence or a default "good".
 */
import { contentHashOf } from '@/lib/attestation'

export type BadgeTone = 'good' | 'warn' | 'bad' | 'plain'
export type BadgeLine = { label: string; value: string; tone: BadgeTone }

export function verificationBadgeLines(input: {
  repoFullName: string
  baseBranch: string
  diff: string
  onchainJobId: number | null
  ciStatus: string | null
  workerName?: string | null
}): BadgeLine[] {
  const lines: BadgeLine[] = []

  lines.push(
    input.onchainJobId !== null
      ? { label: 'Escrow', value: `bounty held on-chain for job #${input.onchainJobId}`, tone: 'good' }
      : { label: 'Escrow', value: 'no on-chain job id recorded for this submission', tone: 'warn' },
  )

  if (input.ciStatus === 'success') {
    lines.push({ label: 'CI', value: `passed on ${input.repoFullName} — merging releases escrow`, tone: 'good' })
  } else if (input.ciStatus === 'failure') {
    lines.push({ label: 'CI', value: `failed on ${input.repoFullName}`, tone: 'bad' })
  } else {
    lines.push({
      label: 'CI',
      value: `not yet reported — ${input.repoFullName}'s own checks are the independent grader`,
      tone: 'warn',
    })
  }

  const hash = contentHashOf({ text: input.diff })
  lines.push({
    label: 'Diff',
    value: `applied cleanly to ${input.repoFullName}@${input.baseBranch || 'default branch'} — ${hash}`,
    tone: 'good',
  })

  if (input.workerName) {
    lines.push({ label: 'Worked by', value: input.workerName, tone: 'plain' })
  }

  return lines
}

const BADGE_ICON: Record<BadgeTone, string> = { good: '✅', warn: '⚠️', bad: '❌', plain: '·' }

export function verificationBadge(input: Parameters<typeof verificationBadgeLines>[0]): string {
  const rows = verificationBadgeLines(input).map((l) => `| ${BADGE_ICON[l.tone]} ${l.label} | ${l.value} |`)
  return [
    '### Verified before you read it',
    '',
    '| | |',
    '|---|---|',
    ...rows,
    '',
    'This records what is and is not known yet — not a claim that the change is good. ' +
      '[How repo jobs work](https://github.com/kairose-master/ai-agent-credit-dashboard/blob/main/docs/github-jobs.md).',
  ].join('\n')
}
