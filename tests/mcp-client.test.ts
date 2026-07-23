import { describe, expect, it } from 'vitest'
import {
  parseRpcBody,
  findRpcResponse,
  extractToolText,
  pickToolArgumentKey,
} from '@/lib/mcp-client'

describe('parseRpcBody', () => {
  it('parses a single application/json response', () => {
    const msgs = parseRpcBody('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}', 'application/json')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe(1)
  })

  it('parses a JSON array of messages', () => {
    const msgs = parseRpcBody('[{"id":1,"result":1},{"id":2,"result":2}]', 'application/json')
    expect(msgs.map((m) => m.id)).toEqual([1, 2])
  })

  it('extracts JSON from an SSE (text/event-stream) body', () => {
    const body = [
      'event: message',
      'data: {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"hi"}]}}',
      '',
    ].join('\n')
    const msgs = parseRpcBody(body, 'text/event-stream')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe(3)
  })

  it('skips keep-alive / non-JSON data lines in SSE', () => {
    const body = ['data: ping', 'data: {"id":1,"result":true}', 'data: [DONE]'].join('\n')
    const msgs = parseRpcBody(body, 'text/event-stream')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe(1)
  })

  it('returns [] for an empty or unparseable body', () => {
    expect(parseRpcBody('', 'application/json')).toEqual([])
    expect(parseRpcBody('not json', 'application/json')).toEqual([])
  })
})

describe('findRpcResponse', () => {
  it('finds the message matching the id that has a result or error', () => {
    const msgs = [
      { method: 'notifications/x' },
      { id: 1, result: { a: 1 } },
      { id: 2, result: { b: 2 } },
    ]
    expect(findRpcResponse(msgs, 2)?.result).toEqual({ b: 2 })
  })

  it('ignores notifications and unmatched ids', () => {
    expect(findRpcResponse([{ method: 'x' }, { id: 9, result: 1 }], 1)).toBeUndefined()
  })
})

describe('extractToolText', () => {
  it('joins text content items', () => {
    expect(extractToolText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('a\nb')
  })

  it('serializes non-text content rather than dropping it', () => {
    const out = extractToolText({ content: [{ type: 'image', data: 'x' }] })
    expect(out).toContain('image')
  })

  it('falls back to structuredContent', () => {
    expect(extractToolText({ structuredContent: { n: 1 } })).toBe('{"n":1}')
  })

  it('returns empty string for null', () => {
    expect(extractToolText(null)).toBe('')
  })
})

describe('pickToolArgumentKey', () => {
  it('prefers a conventionally-named string property', () => {
    expect(pickToolArgumentKey({ properties: { foo: { type: 'string' }, prompt: { type: 'string' } } })).toBe('prompt')
  })

  it('prefers task over prompt when both exist', () => {
    expect(pickToolArgumentKey({ properties: { prompt: { type: 'string' }, task: { type: 'string' } } })).toBe('task')
  })

  it('falls back to the first required string when no conventional name matches', () => {
    expect(
      pickToolArgumentKey({ properties: { alpha: { type: 'string' }, beta: { type: 'string' } }, required: ['beta'] }),
    ).toBe('beta')
  })

  it('falls back to the first string property when nothing required', () => {
    expect(pickToolArgumentKey({ properties: { onlyOne: { type: 'string' } } })).toBe('onlyOne')
  })

  it('defaults to "task" when the schema has no usable properties', () => {
    expect(pickToolArgumentKey({})).toBe('task')
    expect(pickToolArgumentKey(undefined)).toBe('task')
  })
})
