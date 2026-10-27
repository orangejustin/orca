/**
 * Cross-CLI usage query. Every total, breakdown and chart point is folded from the same filtered
 * rows, so any filter leaves each dimension summing to the same figure.
 */

export type UsageQueryScope = 'orca' | 'all'
export type UsageQueryRange = '7d' | '30d' | '90d' | 'all'

/**
 * Where a cost came from. `reported` is the figure the CLI wrote to its own log; `estimated` is an
 * API-equivalent computed from Orca's price table; `unknown` means neither exists. They are never
 * folded into one number: a reported cost is not a plan bill and an estimate is not a reported one.
 */
export type UsageCostBasis = 'reported' | 'estimated' | 'unknown'

export type UsageQueryFilters = {
  scope: UsageQueryScope
  range: UsageQueryRange
  /** Null means every host. */
  hostIds: string[] | null
  clis: string[] | null
  providers: string[] | null
  /** Model keys; a row with no model uses `UNKNOWN_USAGE_MODEL_KEY`. */
  models: string[] | null
  projectKeys: string[] | null
}

export const UNKNOWN_USAGE_MODEL_KEY = 'unknown'

export const DEFAULT_USAGE_QUERY_FILTERS: UsageQueryFilters = {
  scope: 'orca',
  range: '30d',
  hostIds: null,
  clis: null,
  providers: null,
  models: null,
  projectKeys: null
}

export type UsageQueryTotals = {
  events: number
  /** Not additive across breakdown rows: one session can touch several projects or models. */
  sessions: number
  /** Input billed at the full rate, excluding cache reads and writes. */
  freshInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Billable output, reasoning included. */
  outputTokens: number
  /** Informational: the reasoning share already counted inside `outputTokens`. */
  reasoningTokens: number
  totalTokens: number
  reportedCostUsd: number | null
  estimatedCostUsd: number | null
  /** `pricedTokens + unpricedTokens === totalTokens`. */
  pricedTokens: number
  unpricedTokens: number
}

export type UsageQueryBreakdownRow = UsageQueryTotals & {
  key: string
  label: string
}

export type UsageQueryDailyPoint = Omit<UsageQueryTotals, 'sessions'> & { day: string }

export type UsageQueryOption = { key: string; label: string }

export type UsageQueryOptions = {
  clis: UsageQueryOption[]
  hosts: UsageQueryOption[]
  providers: UsageQueryOption[]
  models: UsageQueryOption[]
  projects: UsageQueryOption[]
}

export type UsageQueryResult = {
  filters: UsageQueryFilters
  totals: UsageQueryTotals
  daily: UsageQueryDailyPoint[]
  byCli: UsageQueryBreakdownRow[]
  byHost: UsageQueryBreakdownRow[]
  byProvider: UsageQueryBreakdownRow[]
  byModel: UsageQueryBreakdownRow[]
  byProject: UsageQueryBreakdownRow[]
  /** Offered values, narrowed by scope and range only so the pickers stay stable while filtering. */
  options: UsageQueryOptions
  activeDays: number
}
