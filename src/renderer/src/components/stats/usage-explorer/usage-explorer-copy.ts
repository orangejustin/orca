import type { UsageQueryTotals } from '../../../../../shared/usage-query-types'
import type {
  UsageHostStatus,
  UsagePopulation,
  UsagePricingInfo
} from '../../../../../shared/usage-service-types'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import { formatCost } from '../usage-formatters'

export function populationLabel(population: UsagePopulation): string {
  return population === 'orca-worktrees'
    ? translate(
        'auto.components.stats.usage.explorer.populationOrca',
        'Sessions in Orca worktrees only'
      )
    : translate(
        'auto.components.stats.usage.explorer.populationAll',
        'All readable CLI history, inside and outside Orca'
      )
}

export function hostStatusLabel(status: UsageHostStatus): string {
  switch (status) {
    case 'local':
      return translate('auto.components.stats.usage.explorer.statusLocal', 'This computer')
    case 'ok':
      return translate('auto.components.stats.usage.explorer.statusOk', 'Up to date')
    case 'stale':
      return translate('auto.components.stats.usage.explorer.statusStale', 'Stale')
    case 'unavailable':
      return translate('auto.components.stats.usage.explorer.statusUnavailable', 'Unavailable')
    case 'unsupported':
      return translate('auto.components.stats.usage.explorer.statusUnsupported', 'Not covered')
    case 'never-synced':
      return translate('auto.components.stats.usage.explorer.statusNever', 'Not synced yet')
  }
}

/** Statuses that mean the figures for that host may be missing or old. */
export function hostStatusNeedsAttention(status: UsageHostStatus): boolean {
  return status === 'stale' || status === 'unavailable' || status === 'unsupported'
}

export function formatSyncedAt(lastSuccessAt: number | null, now: number): string {
  if (lastSuccessAt === null) {
    return translate('auto.components.stats.usage.explorer.neverSynced', 'Never synced')
  }
  return translate('auto.components.stats.usage.explorer.syncedAgo', 'Last synced {{value0}}', {
    value0: formatUiRelativeTime(lastSuccessAt - now)
  })
}

export type CostSummary = {
  reported: string | null
  estimated: string | null
  /** Tokens with no price at all, which no dollar figure above includes. */
  unpricedTokens: number
  pricedShare: number | null
}

export function summarizeCost(totals: UsageQueryTotals): CostSummary {
  const priced = totals.pricedTokens + totals.unpricedTokens
  return {
    reported: totals.reportedCostUsd === null ? null : formatCost(totals.reportedCostUsd),
    estimated: totals.estimatedCostUsd === null ? null : formatCost(totals.estimatedCostUsd),
    unpricedTokens: totals.unpricedTokens,
    pricedShare: priced > 0 ? totals.pricedTokens / priced : null
  }
}

export function formatShare(share: number | null): string {
  if (share === null) {
    return translate('auto.components.stats.usage.explorer.noShare', 'n/a')
  }
  return `${Math.round(share * 100)}%`
}

export function costBasisLabel(basis: UsagePricingInfo['basis']): string {
  switch (basis) {
    case 'reported':
      return translate('auto.components.stats.usage.explorer.basisReported', 'Recorded by the CLI')
    case 'estimated':
      return translate(
        'auto.components.stats.usage.explorer.basisEstimated',
        'API-equivalent estimate'
      )
    case 'none':
      return translate('auto.components.stats.usage.explorer.basisNone', 'No price available')
  }
}
