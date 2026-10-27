import { eventUsageRows, eventUsageSessionRefs } from '../usage/query/event-usage-rows'
import type { UsageRow, UsageSessionRef } from '../usage/query/unified-usage-row'
import type { MuseUsageDailyAggregate, MuseUsageSession } from './types'

export const MUSE_USAGE_CLI = 'muse'

/** Muse logs carry tokens but no price, so every row stays unpriced. */
export function museUsageRows(
  daily: readonly MuseUsageDailyAggregate[],
  hostId: string
): UsageRow[] {
  return eventUsageRows(daily, {
    cli: MUSE_USAGE_CLI,
    hostId,
    cost: () => ({ usd: null, basis: 'estimated' })
  })
}

export function museUsageSessionRefs(
  sessions: readonly MuseUsageSession[],
  hostId: string
): UsageSessionRef[] {
  return eventUsageSessionRefs(sessions, { cli: MUSE_USAGE_CLI, hostId })
}
