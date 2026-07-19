/**
 * Vision grading — the image-deliverable analogue of code-grading.ts.
 * A vision-capable LLM judges submitted image artifact(s) against the
 * job's acceptance criteria. Grader ≠ solver, same as the Python test
 * runner: the worker never grades its own submission.
 *
 * Verdict semantics mirror gradeSubmission: `passed: true|false` is a
 * usable verdict that drives auto-settlement; `passed: null` means
 * grading was UNAVAILABLE (no vision key configured, provider error) —
 * an infra fact, not evidence about the work — and the job falls back to
 * manual review with the artifacts rendered for the requester.
 */
import Anthropic from '@anthropic-ai/sdk'
import { resolveUserAnthropicKey } from '@/lib/user-keys'

const VISION_MODEL = 'claude-opus-4-8'

const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export interface GradedVerdict {
  passed: boolean | null
  output: string
  gradedAt: string
}

export async function gradeImageSubmission(
  spec: { title: string; description: string | null; acceptanceCriteria: string | null },
  artifacts: { mime: string; dataBase64: string }[],
  requesterOwnerUserId: string | null,
): Promise<GradedVerdict> {
  const gradedAt = new Date().toISOString()
  const images = artifacts.filter((a) => ALLOWED_IMAGE_MIMES.has(a.mime))

  if (images.length === 0) {
    // A definite failure, not an infra gap: the job demanded an image and
    // the submission attached none the grader can read.
    return { passed: false, output: 'No image artifact attached — this job requires an image deliverable.', gradedAt }
  }

  let apiKey: string | null = null
  if (requesterOwnerUserId) {
    apiKey = await resolveUserAnthropicKey(requesterOwnerUserId).catch(() => null)
  }
  if (!apiKey && process.env.REQUIRE_USER_API_KEY !== 'true' && process.env.ANTHROPIC_API_KEY) {
    apiKey = process.env.ANTHROPIC_API_KEY
  }
  if (!apiKey) {
    return {
      passed: null,
      output: 'Vision grading unavailable (no Anthropic key on the requester account) — awaiting manual review.',
      gradedAt,
    }
  }

  try {
    const client = new Anthropic({ apiKey })
    const stream = client.messages.stream({
      model: VISION_MODEL,
      max_tokens: 1500,
      thinking: { type: 'adaptive' },
      system:
        'You are an independent reviewer for an AI-agent labor market. Judge whether the attached image(s) ' +
        'satisfy the acceptance criteria. The criteria are the contract — no invented requirements, no excused ' +
        'failures. Output ONLY a JSON object {"pass": boolean, "reason": "one sentence"}.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Job: ${spec.title}\n\nDescription:\n${spec.description ?? '(none)'}\n\nAcceptance criteria:\n${spec.acceptanceCriteria ?? '(none)'}\n\nAttached: ${images.length} image(s).`,
            },
            ...images.slice(0, 4).map((img) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: img.mime as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
                data: img.dataBase64,
              },
            })),
          ],
        },
      ],
    })
    const message = await stream.finalMessage()
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .replace(/^```(?:json)?\s*|\s*```$/g, '')

    const parsed = JSON.parse(text)
    return {
      passed: Boolean(parsed?.pass),
      output: String(parsed?.reason ?? '(no reason given)'),
      gradedAt,
    }
  } catch (error) {
    return {
      passed: null,
      output: `Vision grading errored (${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}) — awaiting manual review.`,
      gradedAt,
    }
  }
}
