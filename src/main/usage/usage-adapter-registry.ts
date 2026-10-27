import type { Store } from '../persistence'
import { initTraeUsagePath, TraeUsageStore } from '../trae-usage/store'
import type { UnifiedUsageFile } from './usage-provider-store-lifecycle'

/** What the usage service needs from any CLI's store, whichever way it was wired in. */
export type UsageAdapterStore = {
  getCliId(): string
  getScanState(): {
    enabled: boolean
    isScanning: boolean
    lastScanCompletedAt: number | null
    lastScanError: string | null
  }
  setEnabled(enabled: boolean): Promise<unknown>
  refresh(force?: boolean): Promise<unknown>
  getUnifiedUsageFiles(hostId?: string): UnifiedUsageFile[]
  flush(): Promise<void>
}

type RegisteredUsageAdapter = {
  /** Matches the catalog entry in shared/usage-adapter-catalog. */
  id: string
  /** Pin the cache path before Electron renames userData. */
  initPersistence(): void
  createStore(store: Pick<Store, 'getRepos' | 'getAllWorktreeMeta'>): UsageAdapterStore
}

/**
 * CLIs wired through the registry: adding one is an entry here plus its adapter folder, with no
 * IPC, startup or renderer edits. Claude, Codex, OpenCode and Muse predate it and keep their own
 * wiring; they join the same service through the same store interface.
 */
export const REGISTERED_USAGE_ADAPTERS: readonly RegisteredUsageAdapter[] = [
  {
    id: 'trae',
    initPersistence: initTraeUsagePath,
    createStore: (store) => new TraeUsageStore(store)
  }
]

export function initRegisteredUsageAdapterPaths(): void {
  for (const adapter of REGISTERED_USAGE_ADAPTERS) {
    adapter.initPersistence()
  }
}

export function createRegisteredUsageStores(
  store: Pick<Store, 'getRepos' | 'getAllWorktreeMeta'>
): Map<string, UsageAdapterStore> {
  return new Map(
    REGISTERED_USAGE_ADAPTERS.map((adapter) => [adapter.id, adapter.createStore(store)])
  )
}
