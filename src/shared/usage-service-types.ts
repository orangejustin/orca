import type { UsageAdapterCatalogEntry } from './usage-adapter-catalog'
import type { UsageQueryResult } from './usage-query-types'

/**
 * Three independent controls per CLI, each answering a different question:
 * - collecting: whether Orca keeps scanning that CLI's logs (history is kept when off);
 * - excluded: listed, but left out of the current totals;
 * - hidden: excluded and also removed from the lists, restorable from "Hidden".
 */
export type UsagePreferences = {
  excludedClis: string[]
  hiddenClis: string[]
}

export const DEFAULT_USAGE_PREFERENCES: UsagePreferences = { excludedClis: [], hiddenClis: [] }

export type UsageAdapterInfo = UsageAdapterCatalogEntry & {
  collecting: boolean
  isScanning: boolean
  hasData: boolean
  lastScanCompletedAt: number | null
  lastScanError: string | null
  excluded: boolean
  hidden: boolean
}

/**
 * Per-host, per-CLI freshness. A host that cannot be reached keeps its last result and says so;
 * it is never shown as zero.
 */
export type UsageHostStatus =
  | 'local'
  | 'ok'
  | 'stale'
  | 'unavailable'
  | 'unsupported'
  | 'never-synced'

export type UsageHostCliCoverage = {
  cli: string
  status: UsageHostStatus
  /** Epoch ms of the last successful sync; null when there never was one. */
  lastSuccessAt: number | null
  message: string | null
}

export type UsageHostCoverage = {
  hostId: string
  label: string
  clis: UsageHostCliCoverage[]
}

export type UsageDedupeNote = {
  /** Files found identical on more than one host and counted once. */
  duplicateFiles: number
  /**
   * Sessions found on several hosts with different contents (a log copied, then continued on both).
   * Both copies are counted, because rows cannot be traced back to a session, so totals for these
   * may overstate; the number says how many sessions that could affect.
   */
  overlappingSessions: number
}

export type UsagePricingInfo = {
  cli: string
  label: string
  basis: UsageAdapterCatalogEntry['cost']['basis']
  source: string | null
  url: string | null
  /** The price table ships with the app, so this is the Orca version that produced the figure. */
  tableVersion: string
  /** Share of this CLI's tokens in the current view that carry a price; null with no tokens. */
  pricedTokenShare: number | null
}

/** The population the numbers describe, stated beside them so two views are never mixed. */
export type UsagePopulation = 'orca-worktrees' | 'all-readable-history'

export type UsageViewSnapshot = {
  result: UsageQueryResult
  population: UsagePopulation
  adapters: UsageAdapterInfo[]
  /** CLIs Orca can launch but has no usage adapter for. */
  unsupportedClis: { id: string; label: string }[]
  hosts: UsageHostCoverage[]
  dedupe: UsageDedupeNote
  pricing: UsagePricingInfo[]
  preferences: UsagePreferences
  /** The scan time zone every host is bucketed in. */
  timeZone: string
}

export type UsageRefreshArgs = {
  clis?: string[]
  /** Hosts to sync; omitted syncs local only, because opening Stats must not scan every host. */
  hostIds?: string[]
  force?: boolean
}
