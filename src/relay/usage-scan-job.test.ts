import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RELAY_USAGE_SCANNERS,
  runUsageScanJob,
  type RelayUsageScanner,
  type UsageScanJobInput
} from './usage-scan-job'

let root: string
let cacheFile: string

beforeEach(async () => {
  root = await realpath(mkdtempSync(join(tmpdir(), 'orca-usage-scan-job-')))
  cacheFile = join(root, 'cache', 'claude.json')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

type FakeFile = {
  path: string
  mtimeMs: number
  size: number
  sessions: unknown[]
  dailyAggregates: unknown[]
  keys: string[]
}

function fakeScanner(files: () => FakeFile[]) {
  const seenPrevious: unknown[][] = []
  const scanner: RelayUsageScanner = {
    async scan(_worktrees, previous) {
      seenPrevious.push(previous)
      return files().map(({ keys, ...file }) => ({ file, ownedKeys: keys }))
    }
  }
  return { scanner, seenPrevious }
}

const SECRET_PATH = '/home/someone/.claude/projects/private-project/session.jsonl'

function baseFile(overrides: Partial<FakeFile> = {}): FakeFile {
  return {
    path: SECRET_PATH,
    mtimeMs: 1000,
    size: 10,
    sessions: [{ sessionId: 's1' }],
    dailyAggregates: [{ day: '2026-06-10' }],
    keys: ['k1', 'k2'],
    ...overrides
  }
}

function input(overrides: Partial<UsageScanJobInput> = {}): UsageScanJobInput {
  return { cli: 'claude', worktrees: [], timeZone: 'Asia/Tokyo', cacheFile, ...overrides }
}

describe('runUsageScanJob', () => {
  it('returns per-file digests and aggregates but no paths and no event keys', async () => {
    const { scanner } = fakeScanner(() => [baseFile()])
    const output = await runUsageScanJob(input(), { claude: scanner })

    expect(output.files).toHaveLength(1)
    expect(output.files[0].digest).toMatch(/^[0-9a-f]{40}$/)
    const wire = JSON.stringify(output)
    expect(wire).not.toContain('private-project')
    expect(wire).not.toContain('/home/someone')
    expect(wire).not.toContain('"k1"')
  })

  it('hands the previous run’s files to the scanner so the next scan is incremental', async () => {
    const { scanner, seenPrevious } = fakeScanner(() => [baseFile()])
    await runUsageScanJob(input(), { claude: scanner })
    await runUsageScanJob(input(), { claude: scanner })
    expect(seenPrevious[0]).toEqual([])
    expect(seenPrevious[1]).toHaveLength(1)
  })

  it('rescans from scratch when the time zone changes, because every cached day would be wrong', async () => {
    const { scanner, seenPrevious } = fakeScanner(() => [baseFile()])
    await runUsageScanJob(input({ timeZone: 'Asia/Tokyo' }), { claude: scanner })
    await runUsageScanJob(input({ timeZone: 'America/Los_Angeles' }), { claude: scanner })
    expect(seenPrevious[1]).toEqual([])
  })

  it('rescans from scratch when the host’s worktrees change, because attribution depends on them', async () => {
    const { scanner, seenPrevious } = fakeScanner(() => [baseFile()])
    await runUsageScanJob(input(), { claude: scanner })
    await runUsageScanJob(
      input({
        worktrees: [
          { repoId: 'r', worktreeId: 'r::/srv/app', path: '/srv/app', displayName: 'app' }
        ]
      }),
      { claude: scanner }
    )
    expect(seenPrevious[1]).toEqual([])
  })

  it('keeps the revision while files are unchanged and changes it when one moves', async () => {
    let mtimeMs = 1000
    const { scanner } = fakeScanner(() => [baseFile({ mtimeMs })])
    const first = await runUsageScanJob(input(), { claude: scanner })
    const again = await runUsageScanJob(input(), { claude: scanner })
    mtimeMs = 2000
    const changed = await runUsageScanJob(input(), { claude: scanner })
    expect(again.revision).toBe(first.revision)
    expect(changed.revision).not.toBe(first.revision)
  })

  it('treats a corrupt cache as empty rather than failing the scan', async () => {
    mkdirSync(join(root, 'cache'), { recursive: true })
    writeFileSync(cacheFile, '{not json')
    const { scanner, seenPrevious } = fakeScanner(() => [baseFile()])
    await expect(runUsageScanJob(input(), { claude: scanner })).resolves.toBeDefined()
    expect(seenPrevious[0]).toEqual([])
  })

  it('omits files that hold no usage and gives files that own nothing no digest', async () => {
    const { scanner } = fakeScanner(() => [
      baseFile({ sessions: [], dailyAggregates: [] }),
      baseFile({ path: '/b', keys: [] })
    ])
    const output = await runUsageScanJob(input(), { claude: scanner })
    expect(output.files).toHaveLength(1)
    expect(output.files[0].digest).toBeNull()
  })

  it('fails clearly for a CLI it has no scanner for', async () => {
    await expect(runUsageScanJob(input({ cli: 'gemini' }), {})).rejects.toThrow(/No usage scanner/)
  })

  it('gives a copied log the same digest on any host, whatever its path', async () => {
    const left = fakeScanner(() => [baseFile({ path: '/a/one.jsonl', mtimeMs: 1 })])
    const right = fakeScanner(() => [baseFile({ path: '/b/two.jsonl', mtimeMs: 99 })])
    const a = await runUsageScanJob(input({ cacheFile: join(root, 'a.json') }), {
      claude: left.scanner
    })
    const b = await runUsageScanJob(input({ cacheFile: join(root, 'b.json') }), {
      claude: right.scanner
    })
    expect(a.files[0].digest).toBe(b.files[0].digest)
  })
})

describe('the real Trae scanner through the job', () => {
  it('scans a log, then reuses the cache for an unchanged file', async () => {
    const logs = join(root, 'trae-home')
    mkdirSync(logs, { recursive: true })
    const log = join(logs, 'a.jsonl')
    writeFileSync(
      log,
      `${JSON.stringify({
        type: 'token_usage_record',
        timestamp: '2026-06-10T08:00:00Z',
        request_id: 'r1',
        model: 'kimi-k2',
        usage: { input_tokens: 100, output_tokens: 20 }
      })}\n`
    )
    utimesSync(log, new Date(), new Date())
    vi.stubEnv('ORCA_TRAE_USAGE_ROOTS', logs)

    const traeInput = input({ cli: 'trae', cacheFile: join(root, 'cache', 'trae.json') })
    const first = await runUsageScanJob(traeInput, RELAY_USAGE_SCANNERS)
    const second = await runUsageScanJob(traeInput, RELAY_USAGE_SCANNERS)

    expect(first.files).toHaveLength(1)
    expect(first.files[0].digest).not.toBeNull()
    expect(second.revision).toBe(first.revision)
    expect(JSON.stringify(first)).not.toContain(logs)
  })
})
