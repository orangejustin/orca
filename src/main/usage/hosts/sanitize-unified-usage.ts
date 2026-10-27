import type { UsageCostBasis } from '../../../shared/usage-query-types'
import type { UsageRow, UsageSessionRef } from '../query/unified-usage-row'

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const COST_BASES: readonly UsageCostBasis[] = ['reported', 'estimated', 'unknown']
// A single source file holds a bounded history; more than this is corrupt or hostile.
export const MAX_ROWS_PER_REMOTE_FILE = 50_000

const NUMERIC_ROW_FIELDS = [
  'events',
  'freshInputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'outputTokens',
  'reasoningTokens',
  'totalTokens',
  'pricedTokens',
  'unpricedTokens'
] as const

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

export function isWellFormedUsageRow(row: UsageRow): boolean {
  return (
    typeof row.cli === 'string' &&
    typeof row.hostId === 'string' &&
    typeof row.provider === 'string' &&
    typeof row.projectKey === 'string' &&
    typeof row.projectLabel === 'string' &&
    typeof row.day === 'string' &&
    DAY_PATTERN.test(row.day) &&
    (row.model === null || typeof row.model === 'string') &&
    (row.worktreeId === null || typeof row.worktreeId === 'string') &&
    (row.costUsd === null || isCount(row.costUsd)) &&
    COST_BASES.includes(row.costBasis) &&
    NUMERIC_ROW_FIELDS.every((field) => isCount(row[field])) &&
    // The buckets must add up, or a breakdown would stop summing to its total.
    row.totalTokens ===
      row.freshInputTokens + row.cacheReadTokens + row.cacheWriteTokens + row.outputTokens &&
    row.pricedTokens + row.unpricedTokens === row.totalTokens
  )
}

export function isWellFormedSessionRef(session: UsageSessionRef): boolean {
  return (
    typeof session.cli === 'string' &&
    typeof session.hostId === 'string' &&
    typeof session.sessionId === 'string' &&
    typeof session.lastDay === 'string' &&
    DAY_PATTERN.test(session.lastDay) &&
    Array.isArray(session.worktreeIds) &&
    session.worktreeIds.every((id) => id === null || typeof id === 'string') &&
    isStringArray(session.modelKeys) &&
    isStringArray(session.projectKeys) &&
    isStringArray(session.providers)
  )
}

/**
 * Rows built from another machine's data are untrusted: a field that is missing, negative or not
 * a number would otherwise reach a total as NaN. Anything malformed is dropped and counted, never
 * repaired, so a bad record cannot quietly change a figure.
 */
export function sanitizeUnifiedUsage(data: { rows: UsageRow[]; sessions: UsageSessionRef[] }): {
  rows: UsageRow[]
  sessions: UsageSessionRef[]
  droppedRows: number
} {
  if (data.rows.length > MAX_ROWS_PER_REMOTE_FILE) {
    return { rows: [], sessions: [], droppedRows: data.rows.length }
  }
  const rows = data.rows.filter(isWellFormedUsageRow)
  return {
    rows,
    sessions: data.sessions.filter(isWellFormedSessionRef),
    droppedRows: data.rows.length - rows.length
  }
}
