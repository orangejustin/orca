import { record, type JsonRecord } from '../../shared/codex-rollout-jsonl-cursor'
import {
  buildCodexUsageEventKey,
  normalizeRawUsage,
  resolveCodexUsageDelta,
  type CodexUsageRawUsage
} from '../codex-usage/codex-usage-token-delta'
import { ensureNumber, extractString } from '../usage/usage-record-coercion'
import type { TraeUsageParsedEvent } from './types'

/**
 * Trae CLI writes two generations of usage record, read here by their documented names only:
 * `token_usage_record` (one record per request) and the older `token_count` (cumulative snapshots
 * with an optional per-request `last_token_usage`). Field spellings and nesting are tolerated in
 * one place so a real log sample only ever changes this file; see docs/reference/trae-usage-log-format.md.
 */

export type TraeUsageParseContext = {
  sessionId: string
  cwd: string | null
  currentModel: string | null
  /** Running `token_count` totals, so a snapshot becomes the increment since the last one. */
  previousTotals: CodexUsageRawUsage | null
}

const LINE_MARKERS = ['token_usage_record', 'token_count', 'session_meta', 'turn_context']

const INPUT_KEYS = ['input_tokens', 'prompt_tokens', 'input']
const OUTPUT_KEYS = ['output_tokens', 'completion_tokens', 'output']
const CACHED_KEYS = [
  'cached_input_tokens',
  'cache_read_input_tokens',
  'cache_read_tokens',
  'cached_tokens'
]
const REASONING_KEYS = ['reasoning_output_tokens', 'reasoning_tokens']
const REQUEST_ID_KEYS = ['request_id', 'requestId', 'message_id', 'id']
const TIMESTAMP_KEYS = ['timestamp', 'ts', 'time', 'created_at', 'recorded_at']

export function lineMayCarryTraeUsage(line: string): boolean {
  return LINE_MARKERS.some((marker) => line.includes(marker))
}

function firstNumber(source: JsonRecord, keys: readonly string[]): number {
  for (const key of keys) {
    const value = ensureNumber(source[key])
    if (value > 0) {
      return value
    }
  }
  return 0
}

function firstString(source: JsonRecord | undefined, keys: readonly string[]): string | null {
  if (!source) {
    return null
  }
  for (const key of keys) {
    const value = extractString(source[key])
    if (value) {
      return value
    }
  }
  return null
}

function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  // Seconds, milliseconds and microseconds since epoch are all in the wild.
  const millis = value < 1e11 ? value * 1000 : value < 1e14 ? value : Math.floor(value / 1000)
  const parsed = new Date(millis)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function readTimestamp(entry: JsonRecord, payload: JsonRecord | undefined): string | null {
  for (const source of [entry, payload]) {
    if (!source) {
      continue
    }
    for (const key of TIMESTAMP_KEYS) {
      const iso = toIsoTimestamp(source[key])
      if (iso) {
        return iso
      }
    }
  }
  return null
}

function typeTag(source: JsonRecord | undefined): string | null {
  return firstString(source, ['type', 'record_type', 'event_type', 'kind'])
}

function applyContext(
  entry: JsonRecord,
  payload: JsonRecord | undefined,
  ctx: TraeUsageParseContext
) {
  for (const source of [payload, entry]) {
    ctx.sessionId = firstString(source, ['session_id', 'sessionId']) ?? ctx.sessionId
    ctx.cwd = firstString(source, ['cwd', 'working_directory', 'workspace_root']) ?? ctx.cwd
    ctx.currentModel = firstString(source, ['model', 'model_name']) ?? ctx.currentModel
  }
  if (typeTag(entry) === 'session_meta') {
    ctx.sessionId = firstString(payload, ['id']) ?? ctx.sessionId
  }
}

function findUsageBody(entry: JsonRecord, payload: JsonRecord | undefined): JsonRecord | undefined {
  const candidates = [
    record(entry.usage),
    record(entry.token_usage),
    record(payload?.usage),
    record(payload?.token_usage),
    payload,
    entry
  ]
  return candidates.find(
    (candidate) =>
      candidate &&
      (firstNumber(candidate, INPUT_KEYS) > 0 || firstNumber(candidate, OUTPUT_KEYS) > 0)
  )
}

function fromUsageRecord(
  entry: JsonRecord,
  payload: JsonRecord | undefined,
  ctx: TraeUsageParseContext
): TraeUsageParsedEvent | null {
  const timestamp = readTimestamp(entry, payload)
  const body = findUsageBody(entry, payload)
  if (!timestamp || !body) {
    return null
  }
  const inputTokens = firstNumber(body, INPUT_KEYS)
  const outputTokens = firstNumber(body, OUTPUT_KEYS)
  // Cached input is a subset of input and reasoning a subset of output; clamp so a malformed
  // record cannot make derived fresh input negative or double-count.
  const cachedInputTokens = Math.min(firstNumber(body, CACHED_KEYS), inputTokens)
  const reasoningOutputTokens = Math.min(firstNumber(body, REASONING_KEYS), outputTokens)
  const totalTokens = inputTokens + outputTokens
  if (totalTokens === 0) {
    return null
  }
  const requestId = firstString(payload, REQUEST_ID_KEYS) ?? firstString(entry, REQUEST_ID_KEYS)
  return {
    sessionId: ctx.sessionId,
    timestamp,
    // Why: a request id names the request even if a fork re-stamps the copy; without one the
    // content tuple stands in.
    eventKey: requestId
      ? `req:${requestId}`
      : `rec:${[timestamp, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens].join('|')}`,
    source: 'token_usage_record',
    model:
      firstString(body, ['model', 'model_name']) ??
      firstString(entry, ['model', 'model_name']) ??
      ctx.currentModel,
    cwd: ctx.cwd,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens
  }
}

function fromLegacyTokenCount(
  entry: JsonRecord,
  payload: JsonRecord | undefined,
  ctx: TraeUsageParseContext
): TraeUsageParsedEvent | null {
  const timestamp = readTimestamp(entry, payload)
  const info = record(payload?.info) ?? record(entry.info)
  if (!timestamp || !info) {
    // A snapshot with null info is a status update, not a malformed usage record.
    return null
  }
  const totalUsage = normalizeRawUsage(info.total_token_usage)
  const lastUsage = normalizeRawUsage(info.last_token_usage)
  const resolved = resolveCodexUsageDelta(totalUsage, lastUsage, ctx.previousTotals)
  if (!resolved) {
    return null
  }
  if (resolved.kind === 'baseline') {
    ctx.previousTotals = resolved.nextTotals
    return null
  }
  const delta = {
    ...resolved.delta,
    cachedInputTokens: Math.min(resolved.delta.cachedInputTokens, resolved.delta.inputTokens),
    reasoningOutputTokens: Math.min(
      resolved.delta.reasoningOutputTokens,
      resolved.delta.outputTokens
    )
  }
  ctx.previousTotals = resolved.nextTotals
  if (delta.inputTokens + delta.outputTokens === 0) {
    return null
  }
  return {
    sessionId: ctx.sessionId,
    timestamp,
    eventKey: `tc:${buildCodexUsageEventKey(timestamp, totalUsage, lastUsage)}`,
    source: 'token_count',
    model: firstString(info, ['model', 'model_name']) ?? ctx.currentModel,
    cwd: ctx.cwd,
    inputTokens: delta.inputTokens,
    cachedInputTokens: delta.cachedInputTokens,
    outputTokens: delta.outputTokens,
    reasoningOutputTokens: delta.reasoningOutputTokens,
    totalTokens: delta.inputTokens + delta.outputTokens
  }
}

/** Parses one log line. A line that is not a usage record may still update the session context. */
export function parseTraeUsageLine(
  line: string,
  ctx: TraeUsageParseContext
): TraeUsageParsedEvent | null {
  if (!lineMayCarryTraeUsage(line)) {
    return null
  }
  let entry: JsonRecord | undefined
  try {
    entry = record(JSON.parse(line))
  } catch {
    // A partial last line fails here; the size change makes the next scan reparse it.
    return null
  }
  if (!entry) {
    return null
  }
  const payload = record(entry.payload)
  applyContext(entry, payload, ctx)
  const tags = [typeTag(entry), typeTag(payload)]
  if (tags.includes('token_usage_record')) {
    return fromUsageRecord(entry, payload, ctx)
  }
  if (tags.includes('token_count')) {
    return fromLegacyTokenCount(entry, payload, ctx)
  }
  return null
}

/**
 * A request logged as `token_usage_record` may also appear as a legacy `token_count` snapshot;
 * the per-request record is authoritative, so the mirror is dropped rather than counted twice.
 */
export function dropMirroredTokenCounts(events: TraeUsageParsedEvent[]): TraeUsageParsedEvent[] {
  const fingerprint = (event: TraeUsageParsedEvent): string =>
    [event.timestamp, event.inputTokens, event.outputTokens].join('|')
  const recorded = new Set(
    events.filter((event) => event.source === 'token_usage_record').map(fingerprint)
  )
  return events.filter(
    (event) => event.source === 'token_usage_record' || !recorded.has(fingerprint(event))
  )
}
