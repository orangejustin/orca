import { describe, expect, it } from 'vitest'
import {
  dropMirroredTokenCounts,
  parseTraeUsageLine,
  type TraeUsageParseContext
} from './trae-usage-record-parser'

// Synthetic records built from the field names the task names (token_usage_record, token_count).
// They are NOT captured from a real Trae CLI; replace with a real sample when one is available.

function context(overrides: Partial<TraeUsageParseContext> = {}): TraeUsageParseContext {
  return {
    sessionId: 'session-1',
    cwd: null,
    currentModel: null,
    previousTotals: null,
    ...overrides
  }
}

function parse(entry: unknown, ctx = context()) {
  return parseTraeUsageLine(JSON.stringify(entry), ctx)
}

const TS = '2026-06-10T08:00:00.000Z'

describe('token_usage_record', () => {
  it('reads one request with cache as a subset of input and reasoning of output', () => {
    expect(
      parse({
        type: 'token_usage_record',
        timestamp: TS,
        request_id: 'req-1',
        model: 'doubao-seed-1.6',
        usage: {
          input_tokens: 1000,
          cached_input_tokens: 400,
          output_tokens: 200,
          reasoning_tokens: 50
        }
      })
    ).toMatchObject({
      source: 'token_usage_record',
      eventKey: 'req:req-1',
      model: 'doubao-seed-1.6',
      inputTokens: 1000,
      cachedInputTokens: 400,
      outputTokens: 200,
      reasoningOutputTokens: 50,
      totalTokens: 1200
    })
  })

  it('tolerates alternate field names and a nested payload', () => {
    expect(
      parse({
        payload: {
          type: 'token_usage_record',
          timestamp: TS,
          usage: { prompt_tokens: 30, completion_tokens: 10, cache_read_tokens: 5 }
        }
      })
    ).toMatchObject({ inputTokens: 30, outputTokens: 10, cachedInputTokens: 5, totalTokens: 40 })
  })

  it('clamps cached and reasoning tokens that exceed their parent bucket', () => {
    const event = parse({
      type: 'token_usage_record',
      timestamp: TS,
      usage: { input_tokens: 10, cached_input_tokens: 99, output_tokens: 4, reasoning_tokens: 40 }
    })
    expect(event).toMatchObject({
      cachedInputTokens: 10,
      reasoningOutputTokens: 4,
      totalTokens: 14
    })
  })

  it('keys a request without an id on its content, so a copied record maps to the same key', () => {
    const entry = {
      type: 'token_usage_record',
      timestamp: TS,
      usage: { input_tokens: 7, output_tokens: 3 }
    }
    expect(parse(entry)?.eventKey).toBe(parse({ ...entry, session_id: 'copied-session' })?.eventKey)
  })

  it('takes session, cwd and model context from earlier lines and inline fields', () => {
    const ctx = context()
    parse({ type: 'session_meta', payload: { id: 'real-session', cwd: '/work/app' } }, ctx)
    parse({ type: 'turn_context', payload: { model: 'kimi-k2' } }, ctx)
    expect(
      parse(
        { type: 'token_usage_record', timestamp: TS, usage: { input_tokens: 1, output_tokens: 1 } },
        ctx
      )
    ).toMatchObject({ sessionId: 'real-session', cwd: '/work/app', model: 'kimi-k2' })
  })

  it.each([
    ['ISO string', '2026-06-10T08:00:00Z'],
    ['seconds', 1_781_078_400],
    ['milliseconds', 1_781_078_400_000],
    ['microseconds', 1_781_078_400_000_000]
  ])('accepts a %s timestamp', (_label, value) => {
    const event = parse({
      type: 'token_usage_record',
      timestamp: value,
      usage: { input_tokens: 1, output_tokens: 1 }
    })
    expect(event?.timestamp).toMatch(/^2026-06-1\dT/)
  })

  it('ignores zero-token, timestamp-less, malformed and partial lines', () => {
    expect(
      parse({ type: 'token_usage_record', timestamp: TS, usage: { input_tokens: 0 } })
    ).toBeNull()
    expect(parse({ type: 'token_usage_record', usage: { input_tokens: 5 } })).toBeNull()
    expect(parseTraeUsageLine('not json token_usage_record', context())).toBeNull()
    expect(
      parseTraeUsageLine('{"type":"token_usage_record","timestamp":"2026-', context())
    ).toBeNull()
    expect(parseTraeUsageLine('{"type":"message","text":"hello"}', context())).toBeNull()
  })
})

describe('legacy token_count', () => {
  function snapshot(timestamp: string, total: number[], last?: number[]) {
    const usage = ([input, cached, output, reasoning]: number[]) => ({
      input_tokens: input,
      cached_input_tokens: cached,
      output_tokens: output,
      reasoning_output_tokens: reasoning,
      total_tokens: input + output
    })
    return {
      type: 'event_msg',
      timestamp,
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: usage(total),
          ...(last ? { last_token_usage: usage(last) } : {})
        }
      }
    }
  }

  it('turns cumulative snapshots into per-request increments', () => {
    const ctx = context()
    const first = parse(snapshot('2026-06-10T08:00:00Z', [100, 20, 50, 5], [100, 20, 50, 5]), ctx)
    const second = parse(snapshot('2026-06-10T08:01:00Z', [250, 60, 90, 8], [150, 40, 40, 3]), ctx)
    expect(first).toMatchObject({ source: 'token_count', inputTokens: 100, outputTokens: 50 })
    expect(second).toMatchObject({ inputTokens: 150, cachedInputTokens: 40, outputTokens: 40 })
  })

  it('subtracts running totals when a snapshot carries no per-request usage', () => {
    const ctx = context()
    expect(parse(snapshot('2026-06-10T08:00:00Z', [100, 0, 50, 0]), ctx)).toMatchObject({
      inputTokens: 100,
      outputTokens: 50
    })
    expect(parse(snapshot('2026-06-10T08:01:00Z', [180, 0, 70, 0]), ctx)).toMatchObject({
      inputTokens: 80,
      outputTokens: 20
    })
  })

  it('does not count a repeated identical snapshot twice', () => {
    const ctx = context()
    const entry = snapshot('2026-06-10T08:00:00Z', [100, 0, 50, 0], [100, 0, 50, 0])
    expect(parse(entry, ctx)).not.toBeNull()
    expect(parse(entry, ctx)).toBeNull()
  })

  it('ignores a status snapshot whose info is null', () => {
    expect(
      parse({ type: 'event_msg', timestamp: TS, payload: { type: 'token_count', info: null } })
    ).toBeNull()
  })
})

describe('dropMirroredTokenCounts', () => {
  it('drops a legacy snapshot that mirrors a per-request record and keeps unmatched ones', () => {
    const recordEvent = parse({
      type: 'token_usage_record',
      timestamp: TS,
      request_id: 'r1',
      usage: { input_tokens: 100, output_tokens: 20 }
    })!
    const mirror = { ...recordEvent, source: 'token_count' as const, eventKey: 'tc:mirror' }
    const older = {
      ...recordEvent,
      source: 'token_count' as const,
      eventKey: 'tc:older',
      timestamp: '2026-06-09T08:00:00.000Z'
    }
    expect(
      dropMirroredTokenCounts([older, mirror, recordEvent]).map((event) => event.eventKey)
    ).toEqual(['tc:older', 'req:r1'])
  })
})
