import { mkdtempSync, rmSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toSshExecutionHostId } from '../../shared/execution-host'
import { DEFAULT_USAGE_QUERY_FILTERS, type UsageQueryFilters } from '../../shared/usage-query-types'
import type { UsageScanRelayFile } from '../../shared/usage-scan-relay'
import { RemoteUsageCache } from './hosts/remote-usage-cache'
import { UsageHostCoordinator, type UsageHostMux } from './hosts/usage-host-coordinator'
import type { UsageRow } from './query/unified-usage-row'
import type { UsageAdapterStore } from './usage-adapter-registry'
import { UsagePreferencesStore } from './usage-preferences-store'
import { UsageQueryService } from './usage-query-service'
import type { UnifiedUsageFile } from './usage-provider-store-lifecycle'

let dir: string

beforeEach(async () => {
  dir = await realpath(mkdtempSync(join(tmpdir(), 'orca-usage-service-')))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const CLOUD = toSshExecutionHostId('cloud')

function row(
  cli: string,
  hostId: string,
  tokens: number,
  overrides: Partial<UsageRow> = {}
): UsageRow {
  return {
    cli,
    hostId,
    day: '2026-06-10',
    model: cli === 'claude' ? 'claude-opus-4-5' : 'doubao-seed-1.6',
    provider: cli === 'claude' ? 'anthropic' : 'bytedance',
    projectKey: hostId === 'local' ? 'worktree:w1' : `${hostId}|cwd:/srv/app`,
    projectLabel: 'app',
    worktreeId: hostId === 'local' ? 'w1' : null,
    events: 1,
    freshInputTokens: tokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: tokens,
    costUsd: cli === 'claude' ? tokens / 1000 : null,
    costBasis: cli === 'claude' ? 'estimated' : 'unknown',
    pricedTokens: cli === 'claude' ? tokens : 0,
    unpricedTokens: cli === 'claude' ? 0 : tokens,
    ...overrides
  }
}

function localFile(cli: string, digest: string | null, tokens: number): UnifiedUsageFile {
  return { digest, rows: [row(cli, 'local', tokens)], sessions: [] }
}

function fakeStore(cli: string, files: UnifiedUsageFile[], enabled = true) {
  const state = { enabled }
  const refresh = vi.fn(async () => undefined)
  const setEnabled = vi.fn(async (next: boolean) => {
    state.enabled = next
  })
  const store: UsageAdapterStore = {
    getCliId: () => cli,
    getScanState: () => ({
      enabled: state.enabled,
      isScanning: false,
      lastScanCompletedAt: 123,
      lastScanError: null
    }),
    setEnabled,
    refresh,
    getUnifiedUsageFiles: () => files,
    // Remote files are shaped by the wire: aggregates here are plain token counts.
    unifyForeignFile: (hostId, file) => ({
      rows: file.dailyAggregates.map((entry) =>
        row(cli, hostId, typeof entry === 'number' ? entry : 0)
      ),
      sessions: []
    }),
    flush: async () => undefined
  }
  return { store, refresh, setEnabled }
}

const wire = (digest: string | null, ...tokens: number[]): UsageScanRelayFile => ({
  digest,
  sessions: [],
  dailyAggregates: tokens
})

const FILTERS: UsageQueryFilters = { ...DEFAULT_USAGE_QUERY_FILTERS, scope: 'all', range: 'all' }

function build(options: {
  stores: Map<string, UsageAdapterStore>
  remote?: { files: UsageScanRelayFile[]; connected?: boolean }
}) {
  const connected = new Map<string, UsageHostMux>()
  const request = vi.fn(async () => ({
    kind: 'page',
    cli: 'claude',
    revision: 'r1',
    timeZone: 'UTC',
    scannedAt: 1,
    offset: 0,
    nextOffset: null,
    totalFiles: options.remote?.files.length ?? 0,
    files: options.remote?.files ?? []
  }))
  if (options.remote && options.remote.connected !== false) {
    connected.set('cloud', { request, isDisposed: () => false })
  }
  const cache = new RemoteUsageCache(() => join(dir, 'hosts.json'))
  const hosts = options.remote
    ? new UsageHostCoordinator({
        cache,
        listTargets: () => [{ id: 'cloud', label: 'cloud box' }],
        getMux: (id) => connected.get(id),
        getHostWorktrees: () => [],
        getStores: () => options.stores,
        timeZone: () => 'UTC',
        now: () => 50,
        isMethodNotFound: () => false,
        isOutcomeUnverifiable: () => false
      })
    : null
  const preferences = new UsagePreferencesStore(() => join(dir, 'prefs.json'))
  const service = new UsageQueryService({
    getStores: () => options.stores,
    preferences,
    hosts,
    appVersion: '9.9.9',
    timeZone: () => 'UTC',
    localHostLabel: 'This computer',
    launchableClis: {
      claude: 'Claude',
      'claude-agent-teams': 'Claude Agent Teams',
      codex: 'Codex',
      trae: 'Trae',
      opencode: 'OpenCode',
      opencode2: 'OpenCode 2',
      muse: 'Muse',
      gemini: 'Gemini',
      aider: 'Aider'
    }
  })
  return { service, hosts, preferences, connected, request }
}

const ADDITIVE = ['totalTokens', 'pricedTokens', 'unpricedTokens', 'events'] as const

describe('UsageQueryService', () => {
  it('adds a connected host to this computer, and All hosts / one host filter agree', async () => {
    const claude = fakeStore('claude', [localFile('claude', 'l1', 100)])
    const { service, hosts } = build({
      stores: new Map([['claude', claude.store]]),
      remote: { files: [wire('r1', 40)] }
    })
    await hosts?.sync({ clis: ['claude'] })

    const all = await service.query(FILTERS)
    const cloud = await service.query({ ...FILTERS, hostIds: [CLOUD] })
    const local = await service.query({ ...FILTERS, hostIds: ['local'] })

    expect(all.result.totals.totalTokens).toBe(140)
    expect(cloud.result.totals.totalTokens).toBe(40)
    expect(local.result.totals.totalTokens).toBe(100)
    expect(all.result.byHost.map((entry) => entry.label).sort()).toEqual([
      'This computer',
      'cloud box'
    ])
    for (const field of ADDITIVE) {
      expect(cloud.result.totals[field] + local.result.totals[field]).toBe(all.result.totals[field])
    }
  })

  it('counts a log copied to the cloud host once and says how many it set aside', async () => {
    const claude = fakeStore('claude', [localFile('claude', 'same-log', 100)])
    const { service, hosts } = build({
      stores: new Map([['claude', claude.store]]),
      remote: { files: [wire('same-log', 100), wire('cloud-only', 7)] }
    })
    await hosts?.sync({ clis: ['claude'] })

    const view = await service.query(FILTERS)

    expect(view.result.totals.totalTokens).toBe(107)
    expect(view.dedupe.duplicateFiles).toBe(1)
  })

  it('keeps showing a host’s last numbers, flagged stale, after it disconnects', async () => {
    const claude = fakeStore('claude', [localFile('claude', 'l1', 100)])
    const { service, hosts, connected } = build({
      stores: new Map([['claude', claude.store]]),
      remote: { files: [wire('r1', 40)] }
    })
    await hosts?.sync({ clis: ['claude'] })
    connected.delete('cloud')
    await hosts?.sync({ clis: ['claude'] })

    const view = await service.query(FILTERS)

    expect(view.result.totals.totalTokens).toBe(140)
    const claudeCoverage = view.hosts[0].clis.find((entry) => entry.cli === 'claude')
    expect(claudeCoverage).toMatchObject({ status: 'stale', lastSuccessAt: 50 })
  })

  it('leaves excluded and hidden CLIs out of the totals but still lists them', async () => {
    const stores = new Map([
      ['claude', fakeStore('claude', [localFile('claude', 'a', 100)]).store],
      ['trae', fakeStore('trae', [localFile('trae', 'b', 30)]).store]
    ])
    const { service } = build({ stores })

    expect((await service.query(FILTERS)).result.totals.totalTokens).toBe(130)

    await service.setPreferences({ excludedClis: ['trae'], hiddenClis: [] })
    const excluded = await service.query(FILTERS)
    expect(excluded.result.totals.totalTokens).toBe(100)
    expect(excluded.adapters.find((entry) => entry.id === 'trae')).toMatchObject({
      excluded: true,
      hidden: false,
      hasData: true
    })

    await service.setPreferences({ excludedClis: [], hiddenClis: ['claude'] })
    const hidden = await service.query(FILTERS)
    expect(hidden.result.totals.totalTokens).toBe(30)
    expect(hidden.adapters.find((entry) => entry.id === 'claude')?.hidden).toBe(true)
  })

  it('keeps history in the totals after collection is switched off', async () => {
    const trae = fakeStore('trae', [localFile('trae', 'b', 30)])
    const { service } = build({ stores: new Map([['trae', trae.store]]) })

    await service.setCollecting('trae', false)
    const view = await service.query(FILTERS)

    expect(trae.setEnabled).toHaveBeenCalledWith(false)
    expect(view.adapters.find((entry) => entry.id === 'trae')?.collecting).toBe(false)
    expect(view.result.totals.totalTokens).toBe(30)
  })

  it('lists launchable CLIs with no adapter as unsupported, and not the ones another adapter covers', async () => {
    const { service } = build({ stores: new Map() })
    const view = await service.query(FILTERS)
    expect(view.unsupportedClis.map((entry) => entry.id)).toEqual(['aider', 'gemini'])
  })

  it('states the population so two views are never read as one', async () => {
    const { service } = build({ stores: new Map() })
    expect((await service.query({ ...FILTERS, scope: 'orca' })).population).toBe('orca-worktrees')
    expect((await service.query({ ...FILTERS, scope: 'all' })).population).toBe(
      'all-readable-history'
    )
  })

  it('reports where each CLI’s cost comes from, the table version, and how much of it is priced', async () => {
    const stores = new Map([
      ['claude', fakeStore('claude', [localFile('claude', 'a', 100)]).store],
      ['trae', fakeStore('trae', [localFile('trae', 'b', 100)]).store]
    ])
    const { service } = build({ stores })
    const view = await service.query(FILTERS)
    const byCli = Object.fromEntries(view.pricing.map((entry) => [entry.cli, entry]))

    expect(byCli.claude).toMatchObject({
      basis: 'estimated',
      tableVersion: '9.9.9',
      pricedTokenShare: 1
    })
    expect(byCli.claude.source).toMatch(/Anthropic/)
    expect(byCli.opencode.basis).toBe('reported')
    expect(byCli.trae).toMatchObject({ basis: 'none', pricedTokenShare: 0 })
    expect(view.result.totals.estimatedCostUsd).toBe(0.1)
    expect(view.result.totals.unpricedTokens).toBe(100)
  })

  it('marks the unverified Trae log format in the adapter list', async () => {
    const { service } = build({ stores: new Map([['trae', fakeStore('trae', []).store]]) })
    const view = await service.query(FILTERS)
    expect(view.adapters.find((entry) => entry.id === 'trae')?.logFormatVerified).toBe(false)
    expect(view.adapters.find((entry) => entry.id === 'claude')?.logFormatVerified).toBe(true)
  })

  it('refreshes only enabled local CLIs, and syncs hosts only when asked', async () => {
    const claude = fakeStore('claude', [], true)
    const trae = fakeStore('trae', [], false)
    const { service, request } = build({
      stores: new Map([
        ['claude', claude.store],
        ['trae', trae.store]
      ]),
      remote: { files: [] }
    })

    await service.refresh({ force: true })
    expect(claude.refresh).toHaveBeenCalledWith(true)
    expect(trae.refresh).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()

    await service.refresh({ hostIds: [CLOUD] })
    expect(request).toHaveBeenCalled()
  })

  it('keeps every dimension summing to the totals across hosts, filters and preferences', async () => {
    const stores = new Map([
      [
        'claude',
        fakeStore('claude', [localFile('claude', 'a', 100), localFile('claude', 'b', 20)]).store
      ],
      ['trae', fakeStore('trae', [localFile('trae', 'c', 30)]).store]
    ])
    const { service, hosts } = build({ stores, remote: { files: [wire('a', 100), wire('z', 9)] } })
    await hosts?.sync({ clis: ['claude'] })

    for (const filters of [
      FILTERS,
      { ...FILTERS, scope: 'orca' as const },
      { ...FILTERS, hostIds: [CLOUD] },
      { ...FILTERS, clis: ['trae'] },
      { ...FILTERS, providers: ['anthropic'] }
    ]) {
      const { result } = await service.query(filters)
      for (const rows of [
        result.byCli,
        result.byHost,
        result.byProvider,
        result.byModel,
        result.byProject,
        result.daily
      ]) {
        for (const field of ADDITIVE) {
          expect(
            rows.reduce((sum, entry) => sum + entry[field], 0),
            field
          ).toBe(result.totals[field])
        }
      }
    }
  })
})
