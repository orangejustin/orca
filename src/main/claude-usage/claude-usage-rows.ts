import { resolveUsageModelProvider } from '../../shared/usage-model-provider'
import { UNKNOWN_USAGE_MODEL_KEY } from '../../shared/usage-query-types'
import { getLocalUsageDay } from '../usage/usage-calendar-range'
import {
  hostScopedProjectKey,
  priceUsageRow,
  sumUsageRowTokens,
  type UsageRow,
  type UsageSessionRef
} from '../usage/query/unified-usage-row'
import { priceDailyRow } from './claude-usage-report-aggregation'
import type { ClaudeUsageDailyAggregate, ClaudeUsageSession } from './types'

export const CLAUDE_USAGE_CLI = 'claude'

/** Claude reports cache reads and writes as their own buckets beside input, not inside it. */
export function claudeUsageRows(
  daily: readonly ClaudeUsageDailyAggregate[],
  hostId: string
): UsageRow[] {
  return daily.map((row) => {
    const tokens = {
      freshInputTokens: row.inputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      outputTokens: row.outputTokens,
      reasoningTokens: 0
    }
    const totalTokens = sumUsageRowTokens(tokens)
    return {
      cli: CLAUDE_USAGE_CLI,
      hostId,
      day: row.day,
      model: row.model,
      provider: resolveUsageModelProvider(row.model),
      projectKey: hostScopedProjectKey(hostId, row.projectKey),
      projectLabel: row.projectLabel,
      worktreeId: row.worktreeId,
      events: row.turnCount,
      ...tokens,
      totalTokens,
      ...priceUsageRow(totalTokens, priceDailyRow(row).cost, 'estimated')
    }
  })
}

export function claudeUsageSessionRefs(
  sessions: readonly ClaudeUsageSession[],
  hostId: string
): UsageSessionRef[] {
  const refs: UsageSessionRef[] = []
  for (const session of sessions) {
    const lastDay = getLocalUsageDay(session.lastTimestamp)
    if (!lastDay) {
      continue
    }
    refs.push({
      cli: CLAUDE_USAGE_CLI,
      hostId,
      sessionId: session.sessionId,
      lastDay,
      worktreeIds: session.locationBreakdown.map((entry) => entry.worktreeId),
      modelKeys: [session.model ?? UNKNOWN_USAGE_MODEL_KEY],
      projectKeys: session.locationBreakdown.map((entry) =>
        hostScopedProjectKey(hostId, entry.locationKey)
      ),
      providers: [resolveUsageModelProvider(session.model)]
    })
  }
  return refs
}
