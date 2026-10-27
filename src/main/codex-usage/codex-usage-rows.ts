import { eventUsageRows, eventUsageSessionRefs } from '../usage/query/event-usage-rows'
import type { UsageRow, UsageSessionRef } from '../usage/query/unified-usage-row'
import { estimateCostUsd } from './codex-usage-cost-estimate'
import type { CodexUsageDailyAggregate, CodexUsageSession } from './types'

export const CODEX_USAGE_CLI = 'codex'

export function codexUsageRows(
  daily: readonly CodexUsageDailyAggregate[],
  hostId: string
): UsageRow[] {
  return eventUsageRows(daily, {
    cli: CODEX_USAGE_CLI,
    hostId,
    cost: (row) => ({ usd: estimateCostUsd(row.model, row), basis: 'estimated' })
  })
}

export function codexUsageSessionRefs(
  sessions: readonly CodexUsageSession[],
  hostId: string
): UsageSessionRef[] {
  return eventUsageSessionRefs(sessions, { cli: CODEX_USAGE_CLI, hostId })
}
