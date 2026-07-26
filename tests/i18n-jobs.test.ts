import { describe, expect, it } from 'vitest'
import {
  I18N_JOB_LOCALES,
  chunkKeys,
  i18nJobAcceptanceCriteria,
  i18nJobDescription,
  i18nJobTitle,
  localeOfI18nJobTitle,
  missingKeysFor,
  parseTranslationSubmission,
} from '@/lib/i18n-jobs'
import { DICTIONARIES } from '@/lib/i18n-dict'

describe('missingKeysFor', () => {
  it('returns exactly the en keys the locale lacks, sorted', () => {
    const missing = missingKeysFor('zh')
    for (const k of missing) {
      expect(DICTIONARIES.en[k]).toBeDefined()
      expect(DICTIONARIES.zh[k]).toBeUndefined()
    }
    expect([...missing].sort()).toEqual(missing)
  })

  it('locales with thin coverage have a large real backlog', () => {
    // ja ships nav+guide only — the backlog this feature exists to clear.
    expect(missingKeysFor('ja').length).toBeGreaterThan(100)
  })
})

describe('chunkKeys', () => {
  it('splits into chunks of the given size, keeping order and every key', () => {
    const keys = ['a', 'b', 'c', 'd', 'e']
    const chunks = chunkKeys(keys, 2)
    expect(chunks).toEqual([['a', 'b'], ['c', 'd'], ['e']])
  })
})

describe('title round-trip', () => {
  it('localeOfI18nJobTitle recovers the locale from a generated title', () => {
    for (const locale of I18N_JOB_LOCALES) {
      const title = i18nJobTitle(locale, ['x.one', 'x.two'])
      expect(localeOfI18nJobTitle(title)).toBe(locale)
    }
  })

  it('returns null for non-i18n titles', () => {
    expect(localeOfI18nJobTitle('Implement sum_multiples(n)')).toBeNull()
    expect(localeOfI18nJobTitle('i18n → xx: not a locale')).toBeNull()
  })
})

describe('job brief', () => {
  it('description embeds each requested key with its English source', () => {
    const keys = missingKeysFor('ja').slice(0, 3)
    const desc = i18nJobDescription('ja', keys)
    for (const k of keys) {
      expect(desc).toContain(k)
      expect(desc).toContain(JSON.stringify(DICTIONARIES.en[k]))
    }
  })

  it('acceptance criteria pin the exact key set', () => {
    const criteria = i18nJobAcceptanceCriteria('ja', ['a.b', 'c.d'])
    expect(criteria).toContain('EXACTLY these 2: a.b, c.d')
  })
})

describe('parseTranslationSubmission', () => {
  const keys = ['nav.world', 'nav.directory']

  it('parses a bare JSON object', () => {
    const out = parseTranslationSubmission('{"nav.world":"世界","nav.directory":"目录"}', keys)
    expect(out).toEqual({ 'nav.world': '世界', 'nav.directory': '目录' })
  })

  it('parses JSON inside a fenced block with surrounding prose', () => {
    const raw = 'Here you go!\n```json\n{"nav.world": "世界", "nav.directory": "目录"}\n```\nHope that helps.'
    expect(parseTranslationSubmission(raw, keys)).toEqual({ 'nav.world': '世界', 'nav.directory': '目录' })
  })

  it('ignores keys that were not requested and drops empty values', () => {
    const out = parseTranslationSubmission('{"nav.world":"世界","evil.key":"x","nav.directory":"  "}', keys)
    expect(out).toEqual({ 'nav.world': '世界' })
  })

  it('returns null for unparseable output instead of throwing', () => {
    expect(parseTranslationSubmission('sorry, I could not do this task', keys)).toBeNull()
    expect(parseTranslationSubmission('```json\nnot json\n```', keys)).toBeNull()
  })

  it('falls back to the widest brace span when the fence is malformed', () => {
    const raw = 'prefix {"nav.world":"世界"} suffix'
    expect(parseTranslationSubmission(raw, keys)).toEqual({ 'nav.world': '世界' })
  })
})
