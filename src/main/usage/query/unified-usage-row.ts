import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import type { UsageCostBasis } from '../../../shared/usage-query-types'

/**
 * One (day, model, project) bucket of one CLI on one host, in a CLI-neutral shape. Each adapter
 * maps its own token semantics here, so `totalTokens` is always the sum of the four token buckets
 * and nothing downstream has to know whether a CLI counts cache or reasoning inside input/output.
 */
export type UsageRow = {
  cli: string
  hostId: string
  /** Calendar day in the viewing machine's time zone. */
  day: string
  model: string | null
  /** Model service provider, from the log when it names one, else classified from the model id. */
  provider: string
  projectKey: string
  projectLabel: string
  /** Non-null when the work ran in an Orca-managed worktree. */
  worktreeId: string | null
  events: number
  freshInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsd: number | null
  costBasis: UsageCostBasis
  pricedTokens: number
  unpricedTokens: number
}

/** Enough of a session to count it under the same filters as rows, without its transcript. */
export type UsageSessionRef = {
  cli: string
  hostId: string
  sessionId: string
  lastDay: string
  worktreeIds: (string | null)[]
  /** Model keys (`UNKNOWN_USAGE_MODEL_KEY` for none). */
  modelKeys: string[]
  projectKeys: string[]
  providers: string[]
}

export const LOCAL_USAGE_HOST_ID = LOCAL_EXECUTION_HOST_ID

/**
 * Path-derived project keys name a directory, and the same directory string on two machines is two
 * projects. Worktree keys already carry a globally unique id.
 */
export function hostScopedProjectKey(hostId: string, projectKey: string): string {
  if (hostId === LOCAL_USAGE_HOST_ID || projectKey.startsWith('worktree:')) {
    return projectKey
  }
  return `${hostId}|${projectKey}`
}

export function sumUsageRowTokens(
  row: Pick<UsageRow, 'freshInputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'outputTokens'>
): number {
  return row.freshInputTokens + row.cacheReadTokens + row.cacheWriteTokens + row.outputTokens
}

type RowCost = Pick<UsageRow, 'costUsd' | 'costBasis' | 'pricedTokens' | 'unpricedTokens'>

/** A row is priced all-or-nothing: a null cost leaves every token of it unpriced, never free. */
export function priceUsageRow(
  totalTokens: number,
  cost: number | null,
  basis: Exclude<UsageCostBasis, 'unknown'>
): RowCost {
  return cost === null
    ? { costUsd: null, costBasis: 'unknown', pricedTokens: 0, unpricedTokens: totalTokens }
    : { costUsd: cost, costBasis: basis, pricedTokens: totalTokens, unpricedTokens: 0 }
}
