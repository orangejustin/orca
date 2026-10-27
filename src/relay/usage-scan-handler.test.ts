import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { USAGE_SCAN_RELAY_METHOD, usageScanRelayResultSchema } from '../shared/usage-scan-relay'
import { RelayDispatcher } from './dispatcher'
import {
  normalizeUsageScanParams,
  UsageScanHandler,
  type UsageScanRunner
} from './usage-scan-handler'

let dataRoot: string

beforeEach(async () => {
  dataRoot = await realpath(mkdtempSync(join(tmpdir(), 'orca-usage-scan-handler-')))
})

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true })
})

function makeHandler(run: UsageScanRunner, version = 'v1') {
  const dispatcher = new RelayDispatcher(() => {})
  const onRequest = vi.spyOn(dispatcher, 'onRequest')
  const handler = new UsageScanHandler(dispatcher, { dataRoot, version, run })
  return { handler, onRequest }
}

const baseParams = { cli: 'claude', timeZone: 'Asia/Tokyo', worktrees: [] }
const file = (digest: string, padding = 0) => ({
  digest,
  sessions: padding ? ['x'.repeat(padding)] : [],
  dailyAggregates: []
})

function runnerReturning(files: ReturnType<typeof file>[], revision = 'rev-1'): UsageScanRunner {
  return vi.fn(async () => ({ revision, scannedAt: 1_700_000_000_000, files }))
}

describe('UsageScanHandler', () => {
  it('registers the usage.scan relay method', () => {
    const { onRequest } = makeHandler(runnerReturning([]))
    expect(onRequest).toHaveBeenCalledWith(USAGE_SCAN_RELAY_METHOD, expect.any(Function))
  })

  it('answers a schema-valid first page', async () => {
    const { handler } = makeHandler(runnerReturning([file('a')]))
    const result = await handler.handle(normalizeUsageScanParams(baseParams))
    expect(usageScanRelayResultSchema.safeParse(result).success).toBe(true)
    expect(result).toMatchObject({ kind: 'page', offset: 0, nextOffset: null, totalFiles: 1 })
  })

  it('reports a CLI it cannot scan as a coverage gap instead of failing', async () => {
    const run = runnerReturning([])
    const { handler } = makeHandler(run)
    await expect(
      handler.handle(normalizeUsageScanParams({ ...baseParams, cli: 'opencode' }))
    ).resolves.toEqual({ kind: 'unsupported-cli', cli: 'opencode' })
    expect(run).not.toHaveBeenCalled()
  })

  it('passes the viewer’s time zone and a per-version cache file to the scan', async () => {
    const run = runnerReturning([])
    const { handler } = makeHandler(run, 'v7')
    await handler.handle(normalizeUsageScanParams({ ...baseParams, cli: 'trae' }))
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        cli: 'trae',
        timeZone: 'Asia/Tokyo',
        cacheFile: join(dataRoot, 'usage-cache', 'v7', 'trae.json')
      }),
      undefined
    )
  })

  it('answers not-modified when the caller already holds the current revision', async () => {
    const { handler } = makeHandler(runnerReturning([file('a')], 'rev-9'))
    await expect(
      handler.handle(normalizeUsageScanParams({ ...baseParams, knownRevision: 'rev-9' }))
    ).resolves.toEqual({ kind: 'not-modified', revision: 'rev-9' })
  })

  it('cuts a large result into pages that together cover every file once', async () => {
    const files = [file('a', 250_000), file('b', 250_000), file('c', 250_000), file('d', 10)]
    const { handler } = makeHandler(runnerReturning(files))

    const first = await handler.handle(normalizeUsageScanParams(baseParams))
    if (first.kind !== 'page') {
      throw new Error('expected a page')
    }
    const digests = first.files.map((entry) => entry.digest)
    let next = first.nextOffset
    while (next !== null) {
      const page = await handler.handle(
        normalizeUsageScanParams({
          ...baseParams,
          page: { revision: first.revision, offset: next }
        })
      )
      if (page.kind !== 'page') {
        throw new Error('expected a page')
      }
      digests.push(...page.files.map((entry) => entry.digest))
      next = page.nextOffset
    }

    expect(first.nextOffset).not.toBeNull()
    expect(digests).toEqual(['a', 'b', 'c', 'd'])
  })

  it('refuses a page of a result that has since been replaced', async () => {
    const { handler } = makeHandler(runnerReturning([file('a')], 'rev-new'))
    await handler.handle(normalizeUsageScanParams(baseParams))
    await expect(
      handler.handle(
        normalizeUsageScanParams({ ...baseParams, page: { revision: 'rev-old', offset: 0 } })
      )
    ).rejects.toThrow(/changed/)
  })

  it('never runs two scans of one CLI at the same time', async () => {
    let active = 0
    let peak = 0
    const run: UsageScanRunner = async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 15))
      active--
      return { revision: 'r', scannedAt: 1, files: [] }
    }
    const { handler } = makeHandler(run)
    const params = normalizeUsageScanParams(baseParams)
    await Promise.all([handler.handle(params), handler.handle(params), handler.handle(params)])
    expect(peak).toBe(1)
  })

  it('keeps going after one scan fails', async () => {
    const run = vi
      .fn<UsageScanRunner>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ revision: 'r', scannedAt: 1, files: [] })
    const { handler } = makeHandler(run)
    const params = normalizeUsageScanParams(baseParams)
    await expect(handler.handle(params)).rejects.toThrow('boom')
    await expect(handler.handle(params)).resolves.toMatchObject({ kind: 'page' })
  })

  it('removes cache directories left by other relay versions, and only those', async () => {
    mkdirSync(join(dataRoot, 'usage-cache', 'old'), { recursive: true })
    mkdirSync(join(dataRoot, 'usage-cache', 'v1'), { recursive: true })
    writeFileSync(join(dataRoot, 'usage-cache', 'v1', 'claude.json'), '{}')
    const { handler } = makeHandler(runnerReturning([]), 'v1')
    await handler.handle(normalizeUsageScanParams(baseParams))
    await vi.waitFor(() => expect(existsSync(join(dataRoot, 'usage-cache', 'old'))).toBe(false))
    expect(existsSync(join(dataRoot, 'usage-cache', 'v1', 'claude.json'))).toBe(true)
  })
})

describe('normalizeUsageScanParams', () => {
  it('rejects a missing CLI and an invalid time zone', () => {
    expect(() => normalizeUsageScanParams({ timeZone: 'UTC' })).toThrow(/cli/)
    expect(() => normalizeUsageScanParams({ cli: 'claude', timeZone: 'Not/AZone' })).toThrow(
      /time zone/
    )
    expect(() => normalizeUsageScanParams({ cli: 'claude' })).toThrow(/time zone/)
  })

  it('keeps only well-formed worktrees and bounds their count', () => {
    const good = { repoId: 'r', worktreeId: 'r::/a', path: '/a', displayName: 'a' }
    const params = normalizeUsageScanParams({
      ...baseParams,
      worktrees: [good, { repoId: 'r' }, null, 'x', { ...good, path: 'p'.repeat(5000) }]
    })
    expect(params.worktrees).toEqual([good])
  })

  it('drops a malformed page request instead of trusting it', () => {
    expect(
      normalizeUsageScanParams({ ...baseParams, page: { revision: 'r', offset: -1 } }).page
    ).toBeUndefined()
    expect(
      normalizeUsageScanParams({ ...baseParams, page: { revision: 'r', offset: 1.5 } }).page
    ).toBeUndefined()
  })
})
