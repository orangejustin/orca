import { eventUsageRows, eventUsageSessionRefs } from '../usage/query/event-usage-rows'
import type { UsageRow, UsageSessionRef } from '../usage/query/unified-usage-row'
import type { TraeUsageDailyAggregate, TraeUsageSession } from './types'

export const TRAE_USAGE_CLI = 'trae'

/** Trae logs carry tokens but no price, so every row stays unpriced rather than free. */
export function traeUsageRows(
  daily: readonly TraeUsageDailyAggregate[],
  hostId: string
): UsageRow[] {
  return eventUsageRows(daily, {
    cli: TRAE_USAGE_CLI,
    hostId,
    cost: () => ({ usd: null, basis: 'estimated' })
  })
}

export function traeUsageSessionRefs(
  sessions: readonly TraeUsageSession[],
  hostId: string
): UsageSessionRef[] {
  return eventUsageSessionRefs(sessions, { cli: TRAE_USAGE_CLI, hostId })
}
