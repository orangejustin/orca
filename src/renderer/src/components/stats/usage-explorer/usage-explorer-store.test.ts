import { describe, expect, it, vi } from 'vitest'
import type { UsageServiceApi } from '../../../../../preload/api/agent-usage-api'
import { DEFAULT_USAGE_QUERY_FILTERS } from '../../../../../shared/usage-query-types'
import type { UsageViewSnapshot } from '../../../../../shared/usage-service-types'
import { createUsageExplorerStore } from './usage-explorer-store'

function snapshot(totalTokens: number): UsageViewSnapshot {
  return {
    result: {
      filters: DEFAULT_USAGE_QUERY_FILTERS,
      totals: {
        events: 0,
        sessions: 0,
        freshInputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens,
        reportedCostUsd: null,
        estimatedCostUsd: null,
        pricedTokens: 0,
        unpricedTokens: totalTokens
      },
      daily: [],
      byCli: [],
      byHost: [],
      byProvider: [],
      byModel: [],
      byProject: [],
      options: { clis: [], hosts: [], providers: [], models: [], projects: [] },
      activeDays: 0
    },
    population: 'orca-worktrees',
    adapters: [],
    unsupportedClis: [],
    hosts: [],
    dedupe: { duplicateFiles: 0, overlappingSessions: 0 },
    pricing: [],
    preferences: { excludedClis: [], hiddenClis: [] },
    timeZone: 'UTC'
  }
}

function fakeApi(overrides: Partial<UsageServiceApi> = {}) {
  const api: UsageServiceApi = {
    query: vi.fn(async () => snapshot(1)),
    refresh: vi.fn(async () => undefined),
    syncHosts: vi.fn(async () => []),
    setCollecting: vi.fn(async () => undefined),
    setPreferences: vi.fn(async (preferences) => preferences),
    ...overrides
  }
  return api
}

describe('usage explorer store', () => {
  it('opens by reading the cached view and refreshing local logs, and never syncs a host', async () => {
    const api = fakeApi()
    const store = createUsageExplorerStore(() => api)

    await store.getState().open()

    expect(api.query).toHaveBeenCalledTimes(2)
    expect(api.refresh).toHaveBeenCalledWith({ force: false })
    expect(api.syncHosts).not.toHaveBeenCalled()
    expect(store.getState().status).toBe('ready')
  })

  it('re-reads with the merged filters and can return to the default view', async () => {
    const api = fakeApi()
    const store = createUsageExplorerStore(() => api)

    await store.getState().setFilters({ hostIds: ['ssh:cloud'] })
    expect(api.query).toHaveBeenLastCalledWith({
      ...DEFAULT_USAGE_QUERY_FILTERS,
      hostIds: ['ssh:cloud']
    })
    await store.getState().setFilters({ range: '7d' })
    expect(api.query).toHaveBeenLastCalledWith({
      ...DEFAULT_USAGE_QUERY_FILTERS,
      hostIds: ['ssh:cloud'],
      range: '7d'
    })
    await store.getState().resetFilters()
    expect(api.query).toHaveBeenLastCalledWith(DEFAULT_USAGE_QUERY_FILTERS)
  })

  it('keeps the answer to the newest filters when an older query finishes last', async () => {
    let releaseSlow: () => void = () => {}
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })
    const query = vi
      .fn<UsageServiceApi['query']>()
      .mockImplementationOnce(async () => {
        await slow
        return snapshot(111)
      })
      .mockImplementationOnce(async () => snapshot(222))
    const store = createUsageExplorerStore(() => fakeApi({ query }))

    const first = store.getState().setFilters({ range: '7d' })
    const second = store.getState().setFilters({ range: '90d' })
    await second
    releaseSlow()
    await first

    expect(store.getState().snapshot?.result.totals.totalTokens).toBe(222)
  })

  it('keeps the last view on screen and reports the error when a read fails', async () => {
    const query = vi
      .fn<UsageServiceApi['query']>()
      .mockResolvedValueOnce(snapshot(5))
      .mockRejectedValueOnce(new Error('main process busy'))
    const store = createUsageExplorerStore(() => fakeApi({ query }))

    await store.getState().setFilters({})
    await store.getState().setFilters({ range: '7d' })

    expect(store.getState().snapshot?.result.totals.totalTokens).toBe(5)
    expect(store.getState().status).toBe('ready')
    expect(store.getState().error).toBe('main process busy')
  })

  it('reports the desktop API as unavailable instead of throwing', async () => {
    const store = createUsageExplorerStore(() => undefined)
    await expect(store.getState().open()).resolves.toBeUndefined()
    expect(store.getState().status).toBe('unavailable')
  })

  it('shows a host sync as in progress and clears it afterwards, even when it fails', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const syncHosts = vi.fn(async () => {
      await gate
      throw new Error('relay unreachable')
    })
    const store = createUsageExplorerStore(() => fakeApi({ syncHosts }))

    const pending = store.getState().syncHosts()
    expect(store.getState().syncing).toBe(true)
    release()
    await pending

    expect(store.getState().syncing).toBe(false)
    expect(store.getState().error).toBe('relay unreachable')
  })

  it('scans a CLI when collection is switched on, and only records the choice when it is off', async () => {
    const api = fakeApi()
    const store = createUsageExplorerStore(() => api)

    await store.getState().setCollecting('trae', true)
    expect(api.setCollecting).toHaveBeenLastCalledWith({ cli: 'trae', enabled: true })
    expect(api.refresh).toHaveBeenLastCalledWith({ clis: ['trae'], force: true })

    vi.mocked(api.refresh).mockClear()
    await store.getState().setCollecting('trae', false)
    expect(api.setCollecting).toHaveBeenLastCalledWith({ cli: 'trae', enabled: false })
    expect(api.refresh).not.toHaveBeenCalled()
  })

  it('saves preferences and re-reads so the totals reflect them', async () => {
    const api = fakeApi()
    const store = createUsageExplorerStore(() => api)

    await store.getState().setPreferences({ excludedClis: ['trae'], hiddenClis: [] })

    expect(api.setPreferences).toHaveBeenCalledWith({ excludedClis: ['trae'], hiddenClis: [] })
    expect(api.query).toHaveBeenCalledTimes(1)
  })
})
