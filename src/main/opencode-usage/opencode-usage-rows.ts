import { eventUsageRows, eventUsageSessionRefs } from '../usage/query/event-usage-rows'
import type { UsageRow, UsageSessionRef } from '../usage/query/unified-usage-row'
import type { OpenCodeUsageDailyAggregate, OpenCodeUsageSession } from './types'

export const OPENCODE_USAGE_CLI = 'opencode'

/**
 * OpenCode counts cache reads and writes inside input, and reports reasoning beside output rather
 * than inside it, so reasoning is added to the billable output here.
 */
export function openCodeUsageRows(
  daily: readonly OpenCodeUsageDailyAggregate[],
  hostId: string
): UsageRow[] {
  return eventUsageRows(daily, {
    cli: OPENCODE_USAGE_CLI,
    hostId,
    // The CLI wrote this cost to its own log; Orca did not compute it.
    cost: (row) => ({ usd: row.estimatedCostUsd, basis: 'reported' }),
    buckets: (row) => {
      const cached = Math.min(Math.max(row.cachedInputTokens, 0), Math.max(row.inputTokens, 0))
      const cacheWrite = Math.min(Math.max(row.cacheWriteInputTokens ?? 0, 0), cached)
      return {
        freshInputTokens: Math.max(row.inputTokens, 0) - cached,
        cacheReadTokens: cached - cacheWrite,
        cacheWriteTokens: cacheWrite,
        outputTokens: Math.max(row.outputTokens, 0) + Math.max(row.reasoningOutputTokens, 0),
        reasoningTokens: Math.max(row.reasoningOutputTokens, 0)
      }
    }
  })
}

export function openCodeUsageSessionRefs(
  sessions: readonly OpenCodeUsageSession[],
  hostId: string
): UsageSessionRef[] {
  return eventUsageSessionRefs(sessions, { cli: OPENCODE_USAGE_CLI, hostId })
}
