import { mkdirSync, mkdtempSync, rmSync, truncateSync, utimesSync, writeFileSync } from 'node:fs'
import { appendFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => tmpdir()) } }))

import { resolveTraeUsageRoots } from './trae-usage-log-discovery'
import { scanTraeUsageFiles } from './scanner'
import type { TraeUsagePersistedFile } from './types'

// Synthetic logs following the record names in the task; not captured from a real Trae CLI.

let root: string
let cwd: string

beforeEach(async () => {
  root = await realpath(mkdtempSync(join(tmpdir(), 'orca-trae-usage-')))
  cwd = join(root, 'workspace', 'app')
  mkdirSync(cwd, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function record(requestId: string, input: number, output: number, timestamp: string) {
  return {
    type: 'token_usage_record',
    timestamp,
    request_id: requestId,
    session_id: 'session-1',
    cwd,
    model: 'doubao-seed-1.6',
    usage: {
      input_tokens: input,
      cached_input_tokens: Math.floor(input / 2),
      output_tokens: output
    }
  }
}

const jsonl = (entries: unknown[]): string =>
  `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`

function logPath(name: string): string {
  mkdirSync(join(root, 'logs'), { recursive: true })
  return join(root, 'logs', name)
}

async function scan(previous: TraeUsagePersistedFile[] = []) {
  const scanned: number[] = []
  const result = await scanTraeUsageFiles([], previous, (count) => scanned.push(count), [
    join(root, 'logs')
  ])
  return { ...result, parsedFiles: scanned.length }
}

const totalTokens = (result: Awaited<ReturnType<typeof scan>>): number =>
  result.dailyAggregates.reduce((sum, row) => sum + row.totalTokens, 0)

describe('scanTraeUsageFiles', () => {
  it('aggregates a log into a session and a daily row with the fallback id from the file stem', async () => {
    writeFileSync(
      logPath('abc.jsonl'),
      jsonl([
        { ...record('r1', 100, 20, '2026-06-10T08:00:00Z'), session_id: undefined },
        { ...record('r2', 200, 40, '2026-06-10T09:00:00Z'), session_id: undefined }
      ])
    )
    const result = await scan()
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]).toMatchObject({ sessionId: 'abc', eventCount: 2, totalTokens: 360 })
    expect(result.dailyAggregates[0]).toMatchObject({
      model: 'doubao-seed-1.6',
      inputTokens: 300,
      cachedInputTokens: 150,
      outputTokens: 60
    })
  })

  it('does not reparse an unchanged file', async () => {
    writeFileSync(logPath('a.jsonl'), jsonl([record('r1', 100, 20, '2026-06-10T08:00:00Z')]))
    const first = await scan()
    const second = await scan(first.processedFiles)
    expect(first.parsedFiles).toBe(1)
    expect(second.parsedFiles).toBe(0)
    expect(totalTokens(second)).toBe(totalTokens(first))
  })

  it('counts appended records once, never on top of the earlier total', async () => {
    const path = logPath('a.jsonl')
    writeFileSync(path, jsonl([record('r1', 100, 20, '2026-06-10T08:00:00Z')]))
    const first = await scan()
    await appendFile(path, jsonl([record('r2', 50, 10, '2026-06-10T09:00:00Z')]))
    const second = await scan(first.processedFiles)
    expect(totalTokens(first)).toBe(120)
    expect(totalTokens(second)).toBe(180)
  })

  it('shrinks the total when a file is truncated', async () => {
    const path = logPath('a.jsonl')
    const first = jsonl([record('r1', 100, 20, '2026-06-10T08:00:00Z')])
    writeFileSync(path, first + jsonl([record('r2', 50, 10, '2026-06-10T09:00:00Z')]))
    const before = await scan()
    truncateSync(path, first.length)
    const after = await scan(before.processedFiles)
    expect(totalTokens(before)).toBe(180)
    expect(totalTokens(after)).toBe(120)
  })

  it('replaces a file’s contribution when the path is rewritten with different content', async () => {
    const path = logPath('a.jsonl')
    writeFileSync(path, jsonl([record('old', 1000, 100, '2026-06-10T08:00:00Z')]))
    const before = await scan()
    writeFileSync(path, jsonl([record('new', 10, 2, '2026-06-10T08:00:00Z')]))
    utimesSync(path, new Date(), new Date(Date.now() + 5_000))
    const after = await scan(before.processedFiles)
    expect(totalTokens(before)).toBe(1100)
    expect(totalTokens(after)).toBe(12)
  })

  it('skips a half-written last line and picks it up once it completes', async () => {
    const path = logPath('a.jsonl')
    const complete = JSON.stringify(record('r1', 100, 20, '2026-06-10T08:00:00Z'))
    const tail = JSON.stringify(record('r2', 50, 10, '2026-06-10T09:00:00Z'))
    writeFileSync(path, `${complete}\n${tail.slice(0, 40)}`)
    const partial = await scan()
    writeFileSync(path, `${complete}\n${tail}\n`)
    const done = await scan(partial.processedFiles)
    expect(totalTokens(partial)).toBe(120)
    expect(totalTokens(done)).toBe(180)
  })

  it('counts a request copied into a second log (fork/resume) only once', async () => {
    const shared = record('r1', 100, 20, '2026-06-10T08:00:00Z')
    writeFileSync(logPath('a.jsonl'), jsonl([shared]))
    writeFileSync(
      logPath('b.jsonl'),
      jsonl([{ ...shared, session_id: 'forked' }, record('r2', 50, 10, '2026-06-10T09:00:00Z')])
    )
    const result = await scan()
    expect(totalTokens(result)).toBe(180)
  })

  it('lets the surviving copy reclaim events when the owning log disappears', async () => {
    const shared = record('r1', 100, 20, '2026-06-10T08:00:00Z')
    writeFileSync(logPath('a.jsonl'), jsonl([shared]))
    writeFileSync(logPath('b.jsonl'), jsonl([shared]))
    const before = await scan()
    rmSync(logPath('a.jsonl'))
    const after = await scan(before.processedFiles)
    expect(totalTokens(before)).toBe(120)
    expect(totalTokens(after)).toBe(120)
  })

  it('counts a request logged both as token_usage_record and as a mirrored token_count once', async () => {
    const usage = {
      input_tokens: 100,
      cached_input_tokens: 0,
      output_tokens: 20,
      total_tokens: 120
    }
    writeFileSync(
      logPath('a.jsonl'),
      jsonl([
        record('r1', 100, 20, '2026-06-10T08:00:00.000Z'),
        {
          type: 'event_msg',
          timestamp: '2026-06-10T08:00:00.000Z',
          payload: {
            type: 'token_count',
            info: { total_token_usage: usage, last_token_usage: usage }
          }
        }
      ])
    )
    expect(totalTokens(await scan())).toBe(120)
  })

  it('keeps distinct records that happen to share identical content when they carry no id', async () => {
    const twin = {
      type: 'token_usage_record',
      timestamp: '2026-06-10T08:00:00Z',
      cwd,
      usage: { input_tokens: 10, output_tokens: 5 }
    }
    writeFileSync(logPath('a.jsonl'), jsonl([twin, twin]))
    expect(totalTokens(await scan())).toBe(30)
  })

  it('treats a missing root as no data and reads several roots', async () => {
    const result = await scanTraeUsageFiles([], [], undefined, [join(root, 'does-not-exist')])
    expect(result.processedFiles).toEqual([])
  })
})

describe('resolveTraeUsageRoots', () => {
  it('honours an explicit override and otherwise lists the known homes', () => {
    expect(resolveTraeUsageRoots({ ORCA_TRAE_USAGE_ROOTS: ['/a', '/b'].join(':') }, '/h')).toEqual(
      process.platform === 'win32' ? ['/a:/b'] : ['/a', '/b']
    )
    expect(resolveTraeUsageRoots({}, '/h').map((entry) => entry.replaceAll('\\', '/'))).toEqual([
      '/h/.trae-cn',
      '/h/.trae',
      '/h/.cache/coco/sessions'
    ])
    expect(
      resolveTraeUsageRoots({ XDG_CACHE_HOME: '/x' }, '/h').at(-1)?.replaceAll('\\', '/')
    ).toBe('/x/coco/sessions')
  })
})
