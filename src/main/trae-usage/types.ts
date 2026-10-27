import type {
  UsageDailyAggregate,
  UsageLocationBreakdown,
  UsageLocationModelBreakdown,
  UsageModelBreakdown,
  UsageSession
} from '../usage/usage-rollup-records'

/** Trae logs carry no price, so the shared rollups get no extra metric. */
export type TraeUsageMetric = Record<never, never>

export type TraeUsageLocationBreakdown = UsageLocationBreakdown<TraeUsageMetric>
export type TraeUsageModelBreakdown = UsageModelBreakdown<TraeUsageMetric>
export type TraeUsageLocationModelBreakdown = UsageLocationModelBreakdown<TraeUsageMetric>
export type TraeUsageSession = UsageSession<TraeUsageMetric>
export type TraeUsageDailyAggregate = UsageDailyAggregate<TraeUsageMetric>

export type TraeUsageProcessedFile = {
  path: string
  mtimeMs: number
  size: number
}

export type TraeUsagePersistedFile = TraeUsageProcessedFile & {
  sessions: TraeUsageSession[]
  dailyAggregates: TraeUsageDailyAggregate[]
  /** Event keys this file counted, so a record copied into another session log counts once. */
  ownedEventKeys: string[]
  /** True when this file skipped events another file owned; only these reparse when an owner vanishes. */
  hasDeferredClaims: boolean
}

export type TraeUsagePersistedState = {
  schemaVersion: number
  worktreeFingerprint: string | null
  processedFiles: TraeUsagePersistedFile[]
  sessions: TraeUsageSession[]
  dailyAggregates: TraeUsageDailyAggregate[]
  scanState: {
    enabled: boolean
    lastScanStartedAt: number | null
    lastScanCompletedAt: number | null
    lastScanError: string | null
  }
}

/** Which log generation produced an event; a `token_count` mirroring a record is dropped. */
export type TraeUsageEventSource = 'token_usage_record' | 'token_count'

export type TraeUsageParsedEvent = {
  sessionId: string
  timestamp: string
  eventKey: string
  source: TraeUsageEventSource
  model: string | null
  cwd: string | null
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export type TraeUsageAttributedEvent = TraeUsageParsedEvent & {
  day: string
  projectKey: string
  projectLabel: string
  repoId: string | null
  worktreeId: string | null
}
