import {
  USAGE_ADAPTER_AGENT_ALIASES,
  USAGE_ADAPTER_CATALOG
} from '../../shared/usage-adapter-catalog'
import type { UsageQueryFilters } from '../../shared/usage-query-types'
import type {
  UsageAdapterInfo,
  UsageDedupeNote,
  UsageHostCoverage,
  UsagePreferences,
  UsagePricingInfo,
  UsageRefreshArgs,
  UsageViewSnapshot
} from '../../shared/usage-service-types'
import type { UsageHostCoordinator } from './hosts/usage-host-coordinator'
import { mergeHostUsageFiles, type HostUsageFile } from './hosts/usage-host-merge'
import { LOCAL_USAGE_HOST_ID } from './query/unified-usage-row'
import { queryUsage } from './query/usage-row-query'
import type { UsageAdapterStore } from './usage-adapter-registry'
import type { UsagePreferencesStore } from './usage-preferences-store'

export type UsageQueryServiceDeps = {
  /** Every CLI's store by adapter id, however it was wired in. */
  getStores(): ReadonlyMap<string, UsageAdapterStore>
  preferences: UsagePreferencesStore
  /** Absent where no SSH layer exists; the service then reports only this computer. */
  hosts: UsageHostCoordinator | null
  appVersion: string
  timeZone(): string
  localHostLabel: string
  /** Every CLI Orca can launch, so ones without an adapter can be listed as unsupported. */
  launchableClis: Readonly<Record<string, string>>
}

const NO_DEDUPE: UsageDedupeNote = { duplicateFiles: 0, overlappingSessions: 0 }

export class UsageQueryService {
  constructor(private readonly deps: UsageQueryServiceDeps) {}

  async query(filters: UsageQueryFilters): Promise<UsageViewSnapshot> {
    const preferences = this.deps.preferences.get()
    const merged = this.mergeAll()
    const left = new Set([...preferences.excludedClis, ...preferences.hiddenClis])
    const result = queryUsage({
      rows: merged.rows.filter((row) => !left.has(row.cli)),
      sessions: merged.sessions.filter((session) => !left.has(session.cli)),
      filters,
      labels: {
        clis: Object.fromEntries(USAGE_ADAPTER_CATALOG.map((entry) => [entry.id, entry.label])),
        hosts: {
          [LOCAL_USAGE_HOST_ID]: this.deps.localHostLabel,
          ...this.deps.hosts?.getHostLabels()
        }
      }
    })
    const cliWithData = new Set(merged.rows.map((row) => row.cli))
    return {
      result,
      population: filters.scope === 'orca' ? 'orca-worktrees' : 'all-readable-history',
      adapters: this.describeAdapters(preferences, cliWithData),
      unsupportedClis: this.unsupportedClis(),
      hosts: this.deps.hosts?.getCoverage() ?? [],
      dedupe: merged.dedupe,
      pricing: this.describePricing(result.byCli),
      preferences,
      timeZone: this.deps.timeZone()
    }
  }

  /** Refreshes local logs for enabled CLIs. Hosts are synced only when asked for by id. */
  async refresh(args: UsageRefreshArgs = {}): Promise<void> {
    const stores = this.deps.getStores()
    const wanted = args.clis ?? [...stores.keys()]
    await Promise.all(
      wanted.map(async (cli) => {
        const store = stores.get(cli)
        if (store?.getScanState().enabled) {
          await store.refresh(args.force ?? false)
        }
      })
    )
    if (args.hostIds && args.hostIds.length > 0) {
      await this.deps.hosts?.sync({ hostIds: args.hostIds, clis: args.clis })
    }
  }

  async syncHosts(
    args: { hostIds?: string[]; clis?: string[] } = {}
  ): Promise<UsageHostCoverage[]> {
    await this.deps.hosts?.sync(args)
    return this.deps.hosts?.getCoverage() ?? []
  }

  async setCollecting(cli: string, enabled: boolean): Promise<void> {
    await this.deps.getStores().get(cli)?.setEnabled(enabled)
  }

  async setPreferences(preferences: UsagePreferences): Promise<UsagePreferences> {
    return this.deps.preferences.set(preferences)
  }

  async flush(): Promise<void> {
    await this.deps.preferences.flush()
  }

  private mergeAll(): ReturnType<typeof mergeHostUsageFiles> & { dedupe: UsageDedupeNote } {
    const local: HostUsageFile[] = []
    for (const [cli, store] of this.deps.getStores()) {
      for (const file of store.getUnifiedUsageFiles(LOCAL_USAGE_HOST_ID)) {
        local.push({ hostId: LOCAL_USAGE_HOST_ID, cli, ...file })
      }
    }
    const remote = this.deps.hosts?.getFiles() ?? []
    const merged = mergeHostUsageFiles([...local, ...remote], this.deps.hosts?.getHostOrder() ?? [])
    return {
      ...merged,
      dedupe: this.deps.hosts
        ? {
            duplicateFiles: merged.duplicateFiles,
            overlappingSessions: merged.overlappingSessions
          }
        : NO_DEDUPE
    }
  }

  private describeAdapters(
    preferences: UsagePreferences,
    cliWithData: ReadonlySet<string>
  ): UsageAdapterInfo[] {
    const stores = this.deps.getStores()
    return USAGE_ADAPTER_CATALOG.map((entry) => {
      const state = stores.get(entry.id)?.getScanState()
      return {
        ...entry,
        collecting: state?.enabled ?? false,
        isScanning: state?.isScanning ?? false,
        hasData: cliWithData.has(entry.id),
        lastScanCompletedAt: state?.lastScanCompletedAt ?? null,
        lastScanError: state?.lastScanError ?? null,
        excluded: preferences.excludedClis.includes(entry.id),
        hidden: preferences.hiddenClis.includes(entry.id)
      }
    })
  }

  private unsupportedClis(): { id: string; label: string }[] {
    const covered = new Set(USAGE_ADAPTER_CATALOG.map((entry) => entry.id))
    return Object.entries(this.deps.launchableClis)
      .filter(([id]) => !covered.has(id) && !covered.has(USAGE_ADAPTER_AGENT_ALIASES[id] ?? ''))
      .map(([id, label]) => ({ id, label }))
      .sort((left, right) => left.label.localeCompare(right.label))
  }

  private describePricing(
    byCli: { key: string; pricedTokens: number; unpricedTokens: number }[]
  ): UsagePricingInfo[] {
    return USAGE_ADAPTER_CATALOG.map((entry) => {
      const tokens = byCli.find((row) => row.key === entry.id)
      const total = (tokens?.pricedTokens ?? 0) + (tokens?.unpricedTokens ?? 0)
      return {
        cli: entry.id,
        label: entry.label,
        basis: entry.cost.basis,
        source: entry.cost.source,
        url: entry.cost.url,
        // The price table ships inside the app, so the figure is only as new as this version.
        tableVersion: this.deps.appVersion,
        pricedTokenShare: total > 0 ? (tokens?.pricedTokens ?? 0) / total : null
      }
    })
  }
}
