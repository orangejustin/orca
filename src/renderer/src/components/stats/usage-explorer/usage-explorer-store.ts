import { create } from 'zustand'
import type { UsageServiceApi } from '../../../../../preload/api/agent-usage-api'
import {
  DEFAULT_USAGE_QUERY_FILTERS,
  type UsageQueryFilters
} from '../../../../../shared/usage-query-types'
import type { UsagePreferences, UsageViewSnapshot } from '../../../../../shared/usage-service-types'

type ExplorerStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

export type UsageExplorerState = {
  filters: UsageQueryFilters
  snapshot: UsageViewSnapshot | null
  status: ExplorerStatus
  /** Set when the last read failed; the previous snapshot stays on screen beside it. */
  error: string | null
  /** A local scan is running. */
  refreshing: boolean
  /** A remote host sync is running. */
  syncing: boolean
  setFilters: (patch: Partial<UsageQueryFilters>) => Promise<void>
  resetFilters: () => Promise<void>
  /** Reads the cached view, then refreshes local logs. Never touches a remote host. */
  open: () => Promise<void>
  refresh: (force?: boolean) => Promise<void>
  syncHosts: () => Promise<void>
  setCollecting: (cli: string, enabled: boolean) => Promise<void>
  setPreferences: (preferences: UsagePreferences) => Promise<void>
}

/** `getApi` is injected so the store runs against a fake in tests; it resolves undefined where the desktop API is absent. */
export function createUsageExplorerStore(getApi: () => UsageServiceApi | undefined) {
  let latestRequest = 0

  return create<UsageExplorerState>()((set, get) => {
    const load = async (): Promise<void> => {
      const api = getApi()
      if (!api) {
        set({ status: 'unavailable' })
        return
      }
      const request = ++latestRequest
      if (get().snapshot === null) {
        set({ status: 'loading' })
      }
      try {
        const snapshot = await api.query(get().filters)
        // Why: a slower, older query must not overwrite the answer to the filters now on screen.
        if (request === latestRequest) {
          set({ snapshot, status: 'ready', error: null })
        }
      } catch (error) {
        if (request === latestRequest) {
          set({
            status: get().snapshot ? 'ready' : 'idle',
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }

    const runBusy = async (
      flag: 'refreshing' | 'syncing',
      work: (api: UsageServiceApi) => Promise<unknown>
    ): Promise<void> => {
      const api = getApi()
      if (!api) {
        set({ status: 'unavailable' })
        return
      }
      set({ [flag]: true })
      let failure: string | null = null
      try {
        await work(api)
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      } finally {
        set({ [flag]: false })
      }
      await load()
      // Why: the read that follows clears the last error; the failure of this action must outlive it.
      if (failure) {
        set({ error: failure })
      }
    }

    return {
      filters: { ...DEFAULT_USAGE_QUERY_FILTERS },
      snapshot: null,
      status: 'idle',
      error: null,
      refreshing: false,
      syncing: false,
      setFilters: async (patch) => {
        set({ filters: { ...get().filters, ...patch } })
        await load()
      },
      resetFilters: async () => {
        set({ filters: { ...DEFAULT_USAGE_QUERY_FILTERS } })
        await load()
      },
      open: async () => {
        await load()
        await get().refresh(false)
      },
      refresh: (force = false) => runBusy('refreshing', (api) => api.refresh({ force })),
      syncHosts: () => runBusy('syncing', (api) => api.syncHosts({})),
      setCollecting: async (cli, enabled) => {
        await runBusy('refreshing', async (api) => {
          await api.setCollecting({ cli, enabled })
          if (enabled) {
            await api.refresh({ clis: [cli], force: true })
          }
        })
      },
      setPreferences: async (preferences) => {
        const api = getApi()
        if (!api) {
          return
        }
        try {
          await api.setPreferences(preferences)
        } catch (error) {
          set({ error: error instanceof Error ? error.message : String(error) })
        }
        await load()
      }
    }
  })
}

export const useUsageExplorer = createUsageExplorerStore(() => window.api?.usage)
