import { mkdtempSync, rmSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toSshExecutionHostId } from '../../../shared/execution-host'
import type { UsageScanRelayFile } from '../../../shared/usage-scan-relay'
import type { UsageRow } from '../query/unified-usage-row'
import type { UsageAdapterStore } from '../usage-adapter-registry'
import { RemoteUsageCache } from './remote-usage-cache'
import {
  UsageHostCoordinator,
  type UsageHostMux,
  type UsageHostCoordinatorDeps
} from './usage-host-coordinator'

let dir: string
let clock: number
let currentTimeZone: string
let connected: Map<string, UsageHostMux>
let targets: { id: string; label: string }[]

beforeEach(async () => {
  dir = await realpath(mkdtempSync(join(tmpdir(), 'orca-usage-hosts-')))
  clock = 1_000
  currentTimeZone = 'Asia/Tokyo'
  connected = new Map()
  targets = [{ id: 'cloud', label: 'cloud box' }]
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const HOST = toSshExecutionHostId('cloud')

function row(
  hostId: string,
  cli: string,
  tokens: number,
  overrides: Partial<UsageRow> = {}
): UsageRow {
  return {
    cli,
    hostId,
    day: '2026-06-10',
    model: 'claude-opus-4-5',
    provider: 'anthropic',
    projectKey: `${hostId}|cwd:/srv/app`,
    projectLabel: 'srv/app',
    worktreeId: null,
    events: 1,
    freshInputTokens: tokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: tokens,
    costUsd: null,
    costBasis: 'unknown',
    pricedTokens: 0,
    unpricedTokens: tokens,
    ...overrides
  }
}

type ForeignFile = { digest?: string | null; sessions: unknown[]; dailyAggregates: unknown[] }

function fakeStore(cli: string, map?: (hostId: string, file: ForeignFile) => UsageRow[]) {
  const store: UsageAdapterStore = {
    getCliId: () => cli,
    getScanState: () => ({
      enabled: true,
      isScanning: false,
      lastScanCompletedAt: null,
      lastScanError: null
    }),
    setEnabled: async () => undefined,
    refresh: async () => undefined,
    getUnifiedUsageFiles: () => [],
    unifyForeignFile: (hostId, file) => ({
      rows:
        map?.(hostId, file) ??
        file.dailyAggregates.map((entry) =>
          row(hostId, cli, typeof entry === 'number' ? entry : 0)
        ),
      sessions: []
    }),
    flush: async () => undefined
  }
  return store
}

type RelayReply = unknown

function mux(reply: RelayReply) {
  const request = vi.fn(async (_method: string, params: Record<string, unknown>) => {
    const value = typeof reply === 'function' ? reply(params) : reply
    if (value instanceof Error) {
      throw value
    }
    return value
  })
  const fake: UsageHostMux = { request, isDisposed: () => false }
  return { fake, request }
}

function page(files: UsageScanRelayFile[], overrides: Record<string, unknown> = {}) {
  return {
    kind: 'page',
    cli: 'claude',
    revision: 'rev-1',
    timeZone: currentTimeZone,
    scannedAt: 5,
    offset: 0,
    nextOffset: null,
    totalFiles: files.length,
    files,
    ...overrides
  }
}

const wireFile = (digest: string | null, ...tokens: number[]): UsageScanRelayFile => ({
  digest,
  sessions: [],
  dailyAggregates: tokens
})

function makeCoordinator(overrides: Partial<UsageHostCoordinatorDeps> = {}) {
  const cache = new RemoteUsageCache(() => join(dir, 'hosts.json'))
  const stores = new Map([
    ['claude', fakeStore('claude')],
    ['codex', fakeStore('codex')],
    ['trae', fakeStore('trae')]
  ])
  const coordinator = new UsageHostCoordinator({
    cache,
    listTargets: () => targets,
    getMux: (id) => connected.get(id),
    getHostWorktrees: () => [],
    getStores: () => stores,
    timeZone: () => currentTimeZone,
    now: () => clock,
    isMethodNotFound: (error) => error instanceof Error && error.message === 'Method not found',
    isOutcomeUnverifiable: (error) => error instanceof Error && error.message === 'timed out',
    ...overrides
  })
  return { coordinator, cache }
}

const claudeCoverage = (coordinator: UsageHostCoordinator) =>
  coordinator.getCoverage()[0].clis.find((entry) => entry.cli === 'claude')!

const totalTokens = (coordinator: UsageHostCoordinator): number =>
  coordinator
    .getFiles()
    .reduce((sum, file) => sum + file.rows.reduce((s, r) => s + r.totalTokens, 0), 0)

describe('UsageHostCoordinator', () => {
  it('syncs a connected host, stores what it reported and says when', async () => {
    const { fake, request } = mux(page([wireFile('a', 100)]))
    connected.set('cloud', fake)
    const { coordinator } = makeCoordinator()
    clock = 4_000

    await coordinator.sync()

    expect(request).toHaveBeenCalledWith(
      'usage.scan',
      expect.objectContaining({ cli: 'claude', timeZone: 'Asia/Tokyo' }),
      expect.anything()
    )
    expect(claudeCoverage(coordinator)).toMatchObject({ status: 'ok', lastSuccessAt: 4_000 })
    expect(totalTokens(coordinator)).toBe(300)
    expect(coordinator.getFiles()[0]).toMatchObject({ hostId: HOST, digest: 'a' })
  })

  it('keeps the last result and marks it stale when the host drops, instead of showing zero', async () => {
    const { fake } = mux(page([wireFile('a', 100)]))
    connected.set('cloud', fake)
    const { coordinator } = makeCoordinator()
    clock = 4_000
    await coordinator.sync()
    const before = totalTokens(coordinator)

    connected.delete('cloud')
    clock = 9_000
    await coordinator.sync()

    expect(totalTokens(coordinator)).toBe(before)
    expect(claudeCoverage(coordinator)).toMatchObject({ status: 'stale', lastSuccessAt: 4_000 })
    expect(claudeCoverage(coordinator).message).toMatch(/not connected/i)
  })

  it('reports a host that was never reachable as unavailable with no data', async () => {
    const { coordinator } = makeCoordinator()
    await coordinator.sync()
    expect(coordinator.getFiles()).toEqual([])
    expect(claudeCoverage(coordinator)).toMatchObject({
      status: 'unavailable',
      lastSuccessAt: null
    })
  })

  it('reports a host never synced as such until it is asked', () => {
    const { coordinator } = makeCoordinator()
    expect(claudeCoverage(coordinator)).toMatchObject({
      status: 'never-synced',
      lastSuccessAt: null
    })
  })

  it('recovers to ok with fresh data once the host reconnects', async () => {
    const { coordinator } = makeCoordinator()
    await coordinator.sync()
    const { fake } = mux(page([wireFile('b', 10)], { revision: 'rev-2' }))
    connected.set('cloud', fake)
    clock = 7_000

    await coordinator.sync()

    expect(claudeCoverage(coordinator)).toMatchObject({ status: 'ok', lastSuccessAt: 7_000 })
    expect(totalTokens(coordinator)).toBe(30)
  })

  it('treats a timeout as unknown, never as absence', async () => {
    const { fake } = mux(new Error('timed out'))
    connected.set('cloud', fake)
    const { coordinator } = makeCoordinator()
    await coordinator.sync()
    expect(claudeCoverage(coordinator).status).toBe('unavailable')
    expect(claudeCoverage(coordinator).message).toMatch(/unknown, not zero/)
  })

  it('flags a relay too old to know the method as unsupported and keeps older data', async () => {
    const good = mux(page([wireFile('a', 100)]))
    connected.set('cloud', good.fake)
    const { coordinator } = makeCoordinator()
    await coordinator.sync()

    connected.set('cloud', mux(new Error('Method not found')).fake)
    await coordinator.sync()

    expect(claudeCoverage(coordinator).status).toBe('unsupported')
    expect(claudeCoverage(coordinator).message).toMatch(/Reconnect the host/)
    expect(totalTokens(coordinator)).toBe(300)
  })

  it('reports a relay that lacks one CLI as unsupported for that CLI only', async () => {
    connected.set(
      'cloud',
      mux((params) =>
        params.cli === 'trae' ? { kind: 'unsupported-cli', cli: 'trae' } : page([wireFile('a', 1)])
      ).fake
    )
    const { coordinator } = makeCoordinator()
    await coordinator.sync()
    const byCli = Object.fromEntries(
      coordinator.getCoverage()[0].clis.map((entry) => [entry.cli, entry.status])
    )
    expect(byCli).toMatchObject({ claude: 'ok', codex: 'ok', trae: 'unsupported' })
  })

  it('states plainly which CLIs are not scanned on remote hosts at all', () => {
    const { coordinator } = makeCoordinator()
    const opencode = coordinator.getCoverage()[0].clis.find((entry) => entry.cli === 'opencode')
    expect(opencode).toMatchObject({ status: 'unsupported' })
    expect(opencode?.message).toMatch(/not scanned on remote hosts/i)
  })

  it('asks for only what changed: an unchanged host answers not-modified and is not re-read', async () => {
    const { fake, request } = mux((params) =>
      params.knownRevision === 'rev-1'
        ? { kind: 'not-modified', revision: 'rev-1' }
        : page([wireFile('a', 100)])
    )
    connected.set('cloud', fake)
    const { coordinator } = makeCoordinator()
    await coordinator.sync({ clis: ['claude'] })
    clock = 8_000
    await coordinator.sync({ clis: ['claude'] })

    expect(request).toHaveBeenLastCalledWith(
      'usage.scan',
      expect.objectContaining({ knownRevision: 'rev-1' }),
      expect.anything()
    )
    expect(claudeCoverage(coordinator)).toMatchObject({ status: 'ok', lastSuccessAt: 8_000 })
    expect(totalTokens(coordinator)).toBe(100)
  })

  it('reads a result delivered in several pages', async () => {
    const { fake } = mux((params) => {
      const requested = params.page
      const offset =
        typeof requested === 'object' && requested !== null && 'offset' in requested
          ? requested.offset
          : null
      return offset === 1
        ? page([wireFile('b', 20)], { offset: 1, nextOffset: null })
        : page([wireFile('a', 10)], { nextOffset: 1, totalFiles: 2 })
    })
    connected.set('cloud', fake)
    const { coordinator } = makeCoordinator()
    await coordinator.sync({ clis: ['claude'] })
    expect(coordinator.getFiles().map((file) => file.digest)).toEqual(['a', 'b'])
  })

  it('starts over once when the host replaces its result between pages', async () => {
    let calls = 0
    const { fake } = mux((params) => {
      calls++
      if (params.page && calls === 2) {
        return new Error('Usage scan result changed while it was being read; start the sync again')
      }
      return params.page
        ? page([wireFile('b', 1)], { revision: 'rev-2', offset: 1 })
        : page([wireFile('a', 1)], {
            revision: calls === 1 ? 'rev-1' : 'rev-2',
            nextOffset: 1,
            totalFiles: 2
          })
    })
    connected.set('cloud', fake)
    const { coordinator } = makeCoordinator()
    await coordinator.sync({ clis: ['claude'] })
    expect(claudeCoverage(coordinator).status).toBe('ok')
    expect(coordinator.getFiles().map((file) => file.digest)).toEqual(['a', 'b'])
  })

  it('ignores cached rows recorded in another time zone and says so', async () => {
    connected.set('cloud', mux(page([wireFile('a', 100)])).fake)
    const { coordinator } = makeCoordinator()
    await coordinator.sync({ clis: ['claude'] })

    currentTimeZone = 'America/Los_Angeles'
    expect(coordinator.getFiles()).toEqual([])
    expect(claudeCoverage(coordinator)).toMatchObject({ status: 'stale' })
    expect(claudeCoverage(coordinator).message).toMatch(/time zone/)
  })

  it('does not offer a known revision recorded in another zone', async () => {
    const { fake, request } = mux(page([wireFile('a', 1)]))
    connected.set('cloud', fake)
    const { coordinator } = makeCoordinator()
    await coordinator.sync({ clis: ['claude'] })
    currentTimeZone = 'America/Los_Angeles'
    await coordinator.sync({ clis: ['claude'] })
    expect(request).toHaveBeenLastCalledWith(
      'usage.scan',
      expect.objectContaining({ knownRevision: null, timeZone: 'America/Los_Angeles' }),
      expect.anything()
    )
  })

  it('rejects an unreadable reply without damaging what it already holds', async () => {
    connected.set('cloud', mux(page([wireFile('a', 100)])).fake)
    const { coordinator } = makeCoordinator()
    await coordinator.sync({ clis: ['claude'] })

    connected.set('cloud', mux({ kind: 'page', nonsense: true }).fake)
    await coordinator.sync({ clis: ['claude'] })

    expect(claudeCoverage(coordinator).status).toBe('stale')
    expect(totalTokens(coordinator)).toBe(100)
  })

  it('drops malformed rows from a host and counts them, so no figure becomes NaN', async () => {
    connected.set('cloud', mux(page([wireFile('a', 1)])).fake)
    const stores = new Map([
      [
        'claude',
        fakeStore('claude', (hostId) => [
          row(hostId, 'claude', 5),
          row(hostId, 'claude', Number.NaN),
          row(hostId, 'claude', 5, { day: 'yesterday' }),
          row(hostId, 'claude', 5, { totalTokens: 999 })
        ])
      ]
    ])
    const { coordinator } = makeCoordinator({ getStores: () => stores })
    await coordinator.sync({ clis: ['claude'] })
    expect(totalTokens(coordinator)).toBe(5)
    expect(coordinator.getDroppedRowCount()).toBe(3)
  })

  it('skips a file its mapper cannot read and keeps the host’s other files', async () => {
    connected.set('cloud', mux(page([wireFile('bad', 1), wireFile('good', 7)])).fake)
    const stores = new Map([
      [
        'claude',
        fakeStore('claude', (hostId, file) => {
          if (file.digest === 'bad') {
            throw new Error('unreadable')
          }
          return [row(hostId, 'claude', 7)]
        })
      ]
    ])
    const { coordinator } = makeCoordinator({ getStores: () => stores })
    await coordinator.sync({ clis: ['claude'] })
    expect(coordinator.getFiles().map((file) => file.digest)).toEqual(['good'])
  })

  it('forgets a host that was removed', async () => {
    connected.set('cloud', mux(page([wireFile('a', 1)])).fake)
    const { coordinator, cache } = makeCoordinator()
    await coordinator.sync({ clis: ['claude'] })
    expect(cache.listHostIds()).toEqual([HOST])
    targets = []
    await coordinator.sync()
    expect(cache.listHostIds()).toEqual([])
  })

  it('shares one run between overlapping syncs of a host', async () => {
    const { fake, request } = mux(page([wireFile('a', 1)]))
    connected.set('cloud', fake)
    const { coordinator } = makeCoordinator()
    await Promise.all([coordinator.sync(), coordinator.sync()])
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('reports mixed relay versions per host, so one old host does not hide a current one', async () => {
    targets = [
      { id: 'new-host', label: 'new' },
      { id: 'old-host', label: 'old' }
    ]
    connected.set('new-host', mux(page([wireFile('a', 1)])).fake)
    connected.set('old-host', mux(new Error('Method not found')).fake)
    const { coordinator } = makeCoordinator()
    await coordinator.sync({ clis: ['claude'] })
    const status = Object.fromEntries(
      coordinator
        .getCoverage()
        .map((host) => [host.label, host.clis.find((c) => c.cli === 'claude')?.status])
    )
    expect(status).toEqual({ new: 'ok', old: 'unsupported' })
  })

  it('survives an app restart: a fresh coordinator still shows the last result, marked stale', async () => {
    connected.set('cloud', mux(page([wireFile('a', 100)])).fake)
    const first = makeCoordinator()
    clock = 4_000
    await first.coordinator.sync({ clis: ['claude'] })
    await first.cache.flush()

    const second = makeCoordinator()
    expect(totalTokens(second.coordinator)).toBe(100)
    expect(claudeCoverage(second.coordinator)).toMatchObject({
      status: 'stale',
      lastSuccessAt: 4_000
    })
  })
})
