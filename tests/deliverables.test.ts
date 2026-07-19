import { describe, expect, it } from 'vitest'
import {
  validateArtifacts,
  workerCanDeliver,
  normalizeDeliverableKind,
  MAX_ARTIFACTS_PER_SUBMISSION,
} from '@/lib/artifacts'
import { parsePlannerOutput } from '@/lib/delegation'

const png = (bytes: number) => Buffer.alloc(bytes, 7).toString('base64')

describe('validateArtifacts', () => {
  it('accepts a small image artifact and normalizes fields', () => {
    const [a] = validateArtifacts([{ mime: 'IMAGE/PNG', data_base64: png(1024), name: 'logo.png' }])
    expect(a.mime).toBe('image/png')
    expect(a.name).toBe('logo.png')
    expect(a.size).toBeGreaterThan(1000)
  })

  it('returns [] for missing artifacts', () => {
    expect(validateArtifacts(undefined)).toEqual([])
    expect(validateArtifacts(null)).toEqual([])
  })

  it('rejects unsupported mime types', () => {
    expect(() => validateArtifacts([{ mime: 'application/x-msdownload', data_base64: png(10) }])).toThrow(/unsupported mime/)
  })

  it('rejects oversized artifacts (2MB decoded cap)', () => {
    expect(() => validateArtifacts([{ mime: 'image/png', data_base64: png(2 * 1024 * 1024 + 100) }])).toThrow(/exceeds/)
  })

  it('rejects too many artifacts', () => {
    const many = Array.from({ length: MAX_ARTIFACTS_PER_SUBMISSION + 1 }, () => ({
      mime: 'image/png',
      data_base64: png(10),
    }))
    expect(() => validateArtifacts(many)).toThrow(/too many/)
  })

  it('rejects non-base64 payloads', () => {
    expect(() => validateArtifacts([{ mime: 'image/png', data_base64: 'not base64 !!!' }])).toThrow(/base64/)
  })
})

describe('workerCanDeliver', () => {
  it('treats legacy null/empty capabilities as text-only', () => {
    expect(workerCanDeliver(null, 'text')).toBe(true)
    expect(workerCanDeliver([], 'text')).toBe(true)
    expect(workerCanDeliver(null, 'image')).toBe(false)
  })

  it('matches declared capabilities exactly', () => {
    expect(workerCanDeliver(['text', 'image'], 'image')).toBe(true)
    expect(workerCanDeliver(['text'], 'image')).toBe(false)
    expect(workerCanDeliver(['image'], 'text')).toBe(false) // declared sets are authoritative
  })
})

describe('normalizeDeliverableKind', () => {
  it('defaults anything unknown to text', () => {
    expect(normalizeDeliverableKind(undefined)).toBe('text')
    expect(normalizeDeliverableKind('IMAGE')).toBe('image')
    expect(normalizeDeliverableKind('video')).toBe('text')
    expect(normalizeDeliverableKind('file')).toBe('file')
  })
})

describe('parsePlannerOutput deliverableKind', () => {
  const base = {
    title: 'T',
    description: 'D',
    acceptanceCriteria: 'must satisfy the criteria',
    bountyUsd: 2,
  }

  it('carries image kind through and defaults everything else to text', () => {
    const out = parsePlannerOutput(
      JSON.stringify([
        { ...base, deliverableKind: 'image' },
        { ...base, deliverableKind: 'weird' },
        { ...base },
      ]),
      10,
    )
    expect(out[0].deliverableKind).toBe('image')
    expect(out[1].deliverableKind).toBe('text')
    expect(out[2].deliverableKind).toBe('text')
  })
})
