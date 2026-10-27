import { highestUsageKey } from '../usage/highest-usage-key'
import type {
  ClaudeUsageBreakdownKind,
  ClaudeUsageBreakdownRow,
  ClaudeUsageDailyPoint,
  ClaudeUsageRange,
  ClaudeUsageScope,
  ClaudeUsageSummary
} from '../../shared/claude-usage-types'
import type { ClaudeUsageDailyAggregate, ClaudeUsagePersistedState } from './types'
import { estimateCostUsd, NO_CLAUDE_TIER_ABOVE } from './claude-model-pricing'
import { getFilteredDaily, getFilteredSessions } from './claude-usage-scope-filters'

// Why: each row is priced with its per-request tier sums, never a threshold over the row's total.
// A row whose model has no price entry is unpriced, which is not the same as free.
export function priceDailyRow(row: ClaudeUsageDailyAggregate): {
  cost: number | null
  tokens: number
} {
  return {
    cost: estimateCostUsd(
      row.model,
      row.inputTokens,
      row.outputTokens,
      row.cacheReadTokens,
      row.cacheWriteTokens,
      row.cacheWrite1hTokens,
      row.tierAboveTokens ?? NO_CLAUDE_TIER_ABOVE
    ),
    tokens: row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens
  }
}

export function buildSummary(
  state: ClaudeUsagePersistedState,
  scope: ClaudeUsageScope,
  range: ClaudeUsageRange
): ClaudeUsageSummary {
  const filteredDaily = getFilteredDaily(state, scope, range)
  const filteredSessions = getFilteredSessions(state, scope, range)

  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let turns = 0
  let zeroCacheReadTurns = 0
  const byModel = new Map<string, number>()
  const byProject = new Map<string, number>()
  let estimatedCostUsd = 0
  let pricedTokens = 0
  let unpricedTokens = 0

  for (const row of filteredDaily) {
    inputTokens += row.inputTokens
    outputTokens += row.outputTokens
    cacheReadTokens += row.cacheReadTokens
    cacheWriteTokens += row.cacheWriteTokens
    turns += row.turnCount
    zeroCacheReadTurns += row.zeroCacheReadTurnCount
    const modelKey = row.model ?? 'Unknown model'
    byModel.set(modelKey, (byModel.get(modelKey) ?? 0) + row.inputTokens + row.outputTokens)
    byProject.set(
      row.projectLabel,
      (byProject.get(row.projectLabel) ?? 0) + row.inputTokens + row.outputTokens
    )
    const { cost, tokens } = priceDailyRow(row)
    if (cost === null) {
      unpricedTokens += tokens
    } else {
      estimatedCostUsd += cost
      pricedTokens += tokens
    }
  }

  const topModel = highestUsageKey(byModel)
  const topProject = highestUsageKey(byProject)

  return {
    scope,
    range,
    sessions: filteredSessions.length,
    turns,
    zeroCacheReadTurns,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheReuseRate:
      inputTokens + cacheReadTokens > 0 ? cacheReadTokens / (inputTokens + cacheReadTokens) : null,
    estimatedCostUsd: pricedTokens > 0 ? estimatedCostUsd : null,
    hasUnpricedModels: unpricedTokens > 0,
    pricedTokenShare:
      pricedTokens + unpricedTokens > 0 ? pricedTokens / (pricedTokens + unpricedTokens) : null,
    topModel,
    topProject,
    // Why: the empty-state UX is scope/range specific. Using global persisted
    // data here makes the Orca-only view render empty charts instead of the
    // intended "no usage for this scope" message when only off-Orca logs exist.
    hasAnyClaudeData: filteredSessions.length > 0 || filteredDaily.length > 0
  }
}

export function buildDaily(
  state: ClaudeUsagePersistedState,
  scope: ClaudeUsageScope,
  range: ClaudeUsageRange
): ClaudeUsageDailyPoint[] {
  const byDay = new Map<string, ClaudeUsageDailyPoint>()
  for (const row of getFilteredDaily(state, scope, range)) {
    const existing = byDay.get(row.day) ?? {
      day: row.day,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0
    }
    existing.inputTokens += row.inputTokens
    existing.outputTokens += row.outputTokens
    existing.cacheReadTokens += row.cacheReadTokens
    existing.cacheWriteTokens += row.cacheWriteTokens
    byDay.set(row.day, existing)
  }
  return [...byDay.values()].sort((left, right) => left.day.localeCompare(right.day))
}

export function buildBreakdown(
  state: ClaudeUsagePersistedState,
  scope: ClaudeUsageScope,
  range: ClaudeUsageRange,
  kind: ClaudeUsageBreakdownKind
): ClaudeUsageBreakdownRow[] {
  const rows = new Map<string, ClaudeUsageBreakdownRow>()
  const pricedTokensByKey = new Map<string, number>()
  const filteredDaily = getFilteredDaily(state, scope, range)
  const filteredSessions = getFilteredSessions(state, scope, range)

  for (const daily of filteredDaily) {
    const key = kind === 'model' ? (daily.model ?? 'unknown') : daily.projectKey
    const label = kind === 'model' ? (daily.model ?? 'Unknown model') : daily.projectLabel
    const existing = rows.get(key) ?? {
      key,
      label,
      sessions: 0,
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: null,
      hasUnpricedTokens: false
    }
    existing.turns += daily.turnCount
    existing.inputTokens += daily.inputTokens
    existing.outputTokens += daily.outputTokens
    existing.cacheReadTokens += daily.cacheReadTokens
    existing.cacheWriteTokens += daily.cacheWriteTokens
    const { cost, tokens } = priceDailyRow(daily)
    if (cost === null) {
      existing.hasUnpricedTokens = true
    } else {
      existing.estimatedCostUsd = (existing.estimatedCostUsd ?? 0) + cost
      pricedTokensByKey.set(key, (pricedTokensByKey.get(key) ?? 0) + tokens)
    }
    rows.set(key, existing)
  }

  for (const session of filteredSessions) {
    if (kind === 'model') {
      const key = session.model ?? 'unknown'
      const row = rows.get(key)
      if (row) {
        row.sessions++
      }
      continue
    }
    const matchingLocations = session.locationBreakdown.filter((entry) =>
      scope === 'all' ? true : entry.worktreeId !== null
    )
    const seen = new Set<string>()
    for (const location of matchingLocations) {
      if (seen.has(location.locationKey)) {
        continue
      }
      seen.add(location.locationKey)
      const row = rows.get(location.locationKey)
      if (row) {
        row.sessions++
      }
    }
  }

  for (const row of rows.values()) {
    if ((pricedTokensByKey.get(row.key) ?? 0) === 0) {
      row.estimatedCostUsd = null
    }
  }

  return [...rows.values()].sort((left, right) => {
    const leftTotal = left.inputTokens + left.outputTokens
    const rightTotal = right.inputTokens + right.outputTokens
    return rightTotal - leftTotal
  })
}
