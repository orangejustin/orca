import { getUsageModelProviderLabel } from '../../../shared/usage-model-provider'
import {
  UNKNOWN_USAGE_MODEL_KEY,
  type UsageQueryBreakdownRow,
  type UsageQueryDailyPoint,
  type UsageQueryFilters,
  type UsageQueryOption,
  type UsageQueryOptions,
  type UsageQueryResult,
  type UsageQueryTotals
} from '../../../shared/usage-query-types'
import { getUsageRangeCutoff } from '../usage-calendar-range'
import type { UsageRow, UsageSessionRef } from './unified-usage-row'

export type UsageQueryLabels = {
  clis: Record<string, string>
  hosts: Record<string, string>
}

type UsageQueryInput = {
  rows: readonly UsageRow[]
  sessions: readonly UsageSessionRef[]
  filters: UsageQueryFilters
  labels: UsageQueryLabels
}

export function emptyUsageTotals(): UsageQueryTotals {
  return {
    events: 0,
    sessions: 0,
    freshInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    reportedCostUsd: null,
    estimatedCostUsd: null,
    pricedTokens: 0,
    unpricedTokens: 0
  }
}

function addRow(target: UsageQueryTotals, row: UsageRow): void {
  target.events += row.events
  target.freshInputTokens += row.freshInputTokens
  target.cacheReadTokens += row.cacheReadTokens
  target.cacheWriteTokens += row.cacheWriteTokens
  target.outputTokens += row.outputTokens
  target.reasoningTokens += row.reasoningTokens
  target.totalTokens += row.totalTokens
  target.pricedTokens += row.pricedTokens
  target.unpricedTokens += row.unpricedTokens
  if (row.costUsd !== null && row.costBasis === 'reported') {
    target.reportedCostUsd = (target.reportedCostUsd ?? 0) + row.costUsd
  } else if (row.costUsd !== null && row.costBasis === 'estimated') {
    target.estimatedCostUsd = (target.estimatedCostUsd ?? 0) + row.costUsd
  }
}

function toDailyPoint(day: string, totals: UsageQueryTotals): UsageQueryDailyPoint {
  return {
    day,
    events: totals.events,
    freshInputTokens: totals.freshInputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    outputTokens: totals.outputTokens,
    reasoningTokens: totals.reasoningTokens,
    totalTokens: totals.totalTokens,
    reportedCostUsd: totals.reportedCostUsd,
    estimatedCostUsd: totals.estimatedCostUsd,
    pricedTokens: totals.pricedTokens,
    unpricedTokens: totals.unpricedTokens
  }
}

const modelKeyOf = (row: Pick<UsageRow, 'model'>): string => row.model ?? UNKNOWN_USAGE_MODEL_KEY

function allows(selected: readonly string[] | null, value: string): boolean {
  return selected === null || selected.includes(value)
}

function matchesRow(row: UsageRow, filters: UsageQueryFilters, cutoff: string | null): boolean {
  return (
    (cutoff === null || row.day >= cutoff) &&
    (filters.scope === 'all' || row.worktreeId !== null) &&
    allows(filters.hostIds, row.hostId) &&
    allows(filters.clis, row.cli) &&
    allows(filters.providers, row.provider) &&
    allows(filters.models, modelKeyOf(row)) &&
    allows(filters.projectKeys, row.projectKey)
  )
}

function matchesSession(
  session: UsageSessionRef,
  filters: UsageQueryFilters,
  cutoff: string | null
): boolean {
  const anyAllowed = (selected: readonly string[] | null, values: readonly string[]): boolean =>
    selected === null || values.some((value) => selected.includes(value))
  return (
    (cutoff === null || session.lastDay >= cutoff) &&
    (filters.scope === 'all' || session.worktreeIds.some((id) => id !== null)) &&
    allows(filters.hostIds, session.hostId) &&
    allows(filters.clis, session.cli) &&
    anyAllowed(filters.providers, session.providers) &&
    anyAllowed(filters.models, session.modelKeys) &&
    anyAllowed(filters.projectKeys, session.projectKeys)
  )
}

type Dimension = {
  keyOf: (row: UsageRow) => string
  labelOf: (row: UsageRow) => string
  sessionKeysOf: (session: UsageSessionRef) => readonly string[]
}

function buildBreakdown(
  rows: readonly UsageRow[],
  sessions: readonly UsageSessionRef[],
  dimension: Dimension
): UsageQueryBreakdownRow[] {
  const byKey = new Map<string, UsageQueryBreakdownRow>()
  for (const row of rows) {
    const key = dimension.keyOf(row)
    const existing = byKey.get(key) ?? { key, label: dimension.labelOf(row), ...emptyUsageTotals() }
    addRow(existing, row)
    byKey.set(key, existing)
  }
  for (const session of sessions) {
    for (const key of new Set(dimension.sessionKeysOf(session))) {
      const existing = byKey.get(key)
      if (existing) {
        existing.sessions++
      }
    }
  }
  return [...byKey.values()].sort(
    (left, right) => right.totalTokens - left.totalTokens || left.label.localeCompare(right.label)
  )
}

function buildOptions(
  rows: readonly UsageRow[],
  labels: UsageQueryLabels,
  cutoff: string | null,
  scope: UsageQueryFilters['scope']
): UsageQueryOptions {
  const collect = (
    keyOf: (row: UsageRow) => string,
    labelOf: (row: UsageRow) => string
  ): UsageQueryOption[] => {
    const seen = new Map<string, string>()
    for (const row of rows) {
      if ((cutoff !== null && row.day < cutoff) || (scope === 'orca' && row.worktreeId === null)) {
        continue
      }
      if (!seen.has(keyOf(row))) {
        seen.set(keyOf(row), labelOf(row))
      }
    }
    return [...seen].map(([key, label]) => ({ key, label }))
  }
  const sorted = (options: UsageQueryOption[]): UsageQueryOption[] =>
    options.sort((left, right) => left.label.localeCompare(right.label))
  return {
    clis: sorted(
      collect(
        (row) => row.cli,
        (row) => labels.clis[row.cli] ?? row.cli
      )
    ),
    hosts: sorted(
      collect(
        (row) => row.hostId,
        (row) => labels.hosts[row.hostId] ?? row.hostId
      )
    ),
    providers: sorted(
      collect(
        (row) => row.provider,
        (row) => getUsageModelProviderLabel(row.provider)
      )
    ),
    models: sorted(collect(modelKeyOf, (row) => row.model ?? 'Unknown model')),
    projects: sorted(
      collect(
        (row) => row.projectKey,
        (row) => row.projectLabel
      )
    )
  }
}

export function queryUsage(input: UsageQueryInput): UsageQueryResult {
  const { filters, labels } = input
  const cutoff = getUsageRangeCutoff(filters.range)
  const rows = input.rows.filter((row) => matchesRow(row, filters, cutoff))
  const sessions = input.sessions.filter((session) => matchesSession(session, filters, cutoff))

  const totals = emptyUsageTotals()
  const totalsByDay = new Map<string, UsageQueryTotals>()
  for (const row of rows) {
    addRow(totals, row)
    const dayTotals = totalsByDay.get(row.day) ?? emptyUsageTotals()
    addRow(dayTotals, row)
    totalsByDay.set(row.day, dayTotals)
  }
  totals.sessions = new Set(
    sessions.map((session) => `${session.cli}\u0000${session.hostId}\u0000${session.sessionId}`)
  ).size

  const daily = [...totalsByDay]
    .map(([day, dayTotals]) => toDailyPoint(day, dayTotals))
    .sort((left, right) => left.day.localeCompare(right.day))
  return {
    filters,
    totals,
    daily,
    activeDays: daily.filter((point) => point.totalTokens > 0).length,
    byCli: buildBreakdown(rows, sessions, {
      keyOf: (row) => row.cli,
      labelOf: (row) => labels.clis[row.cli] ?? row.cli,
      sessionKeysOf: (session) => [session.cli]
    }),
    byHost: buildBreakdown(rows, sessions, {
      keyOf: (row) => row.hostId,
      labelOf: (row) => labels.hosts[row.hostId] ?? row.hostId,
      sessionKeysOf: (session) => [session.hostId]
    }),
    byProvider: buildBreakdown(rows, sessions, {
      keyOf: (row) => row.provider,
      labelOf: (row) => getUsageModelProviderLabel(row.provider),
      sessionKeysOf: (session) => session.providers
    }),
    byModel: buildBreakdown(rows, sessions, {
      keyOf: modelKeyOf,
      labelOf: (row) => row.model ?? 'Unknown model',
      sessionKeysOf: (session) => session.modelKeys
    }),
    byProject: buildBreakdown(rows, sessions, {
      keyOf: (row) => row.projectKey,
      labelOf: (row) => row.projectLabel,
      sessionKeysOf: (session) => session.projectKeys
    }),
    options: buildOptions(input.rows, labels, cutoff, filters.scope)
  }
}
