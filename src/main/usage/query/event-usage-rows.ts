import { resolveUsageModelProvider } from '../../../shared/usage-model-provider'
import { UNKNOWN_USAGE_MODEL_KEY } from '../../../shared/usage-query-types'
import { getLocalUsageDay } from '../usage-calendar-range'
import type { UsageDailyAggregate, UsageSession } from '../usage-rollup-records'
import {
  hostScopedProjectKey,
  priceUsageRow,
  sumUsageRowTokens,
  type UsageRow,
  type UsageSessionRef
} from './unified-usage-row'

type RowTokens = Pick<
  UsageRow,
  'freshInputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'outputTokens' | 'reasoningTokens'
>

/**
 * Cached input is a subset of input and reasoning is a subset of output (OpenAI style), so the
 * buckets are carved out rather than added: fresh = input - cached, output keeps its reasoning.
 */
export function subsetTokenBuckets(counts: {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}): RowTokens {
  const cached = Math.min(Math.max(counts.cachedInputTokens, 0), Math.max(counts.inputTokens, 0))
  return {
    freshInputTokens: Math.max(counts.inputTokens, 0) - cached,
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
    outputTokens: Math.max(counts.outputTokens, 0),
    reasoningTokens: Math.min(
      Math.max(counts.reasoningOutputTokens, 0),
      Math.max(counts.outputTokens, 0)
    )
  }
}

type EventDailyRow = UsageDailyAggregate<unknown>

export type EventUsageRowOptions<TRow extends EventDailyRow> = {
  cli: string
  hostId: string
  /** Cost for the row in dollars, or null when this CLI has no price for it. */
  cost: (row: TRow) => { usd: number | null; basis: 'reported' | 'estimated' }
  /** Defaults to cache-in-input / reasoning-in-output; override for a CLI that counts otherwise. */
  buckets?: (row: TRow) => RowTokens
}

export function eventUsageRows<TRow extends EventDailyRow>(
  daily: readonly TRow[],
  options: EventUsageRowOptions<TRow>
): UsageRow[] {
  return daily.map((row) => {
    const tokens = (options.buckets ?? subsetTokenBuckets)(row)
    const totalTokens = sumUsageRowTokens(tokens)
    const { usd, basis } = options.cost(row)
    return {
      cli: options.cli,
      hostId: options.hostId,
      day: row.day,
      model: row.model,
      provider: resolveUsageModelProvider(row.model),
      projectKey: hostScopedProjectKey(options.hostId, row.projectKey),
      projectLabel: row.projectLabel,
      worktreeId: row.worktreeId,
      events: row.eventCount,
      ...tokens,
      totalTokens,
      ...priceUsageRow(totalTokens, usd, basis)
    }
  })
}

type EventSession = Pick<UsageSession<unknown>, 'sessionId' | 'lastTimestamp'> & {
  locationModelBreakdown: readonly {
    locationKey: string
    modelKey: string
    worktreeId: string | null
  }[]
}

export function eventUsageSessionRefs(
  sessions: readonly EventSession[],
  options: { cli: string; hostId: string }
): UsageSessionRef[] {
  const refs: UsageSessionRef[] = []
  for (const session of sessions) {
    const lastDay = getLocalUsageDay(session.lastTimestamp)
    if (!lastDay) {
      continue
    }
    const modelKeys = [...new Set(session.locationModelBreakdown.map((entry) => entry.modelKey))]
    refs.push({
      cli: options.cli,
      hostId: options.hostId,
      sessionId: session.sessionId,
      lastDay,
      worktreeIds: session.locationModelBreakdown.map((entry) => entry.worktreeId),
      modelKeys,
      projectKeys: [
        ...new Set(
          session.locationModelBreakdown.map((entry) =>
            hostScopedProjectKey(options.hostId, entry.locationKey)
          )
        )
      ],
      providers: [
        ...new Set(
          modelKeys.map((key) =>
            resolveUsageModelProvider(key === UNKNOWN_USAGE_MODEL_KEY ? null : key)
          )
        )
      ]
    })
  }
  return refs
}
