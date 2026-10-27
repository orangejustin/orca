import { build } from 'esbuild'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildRelayUsageScanEnv, runUsageScanInChild } from './usage-scan-spawn'

// Forks the real bundled child, so the process boundary, IPC, time zone and environment are
// exercised rather than assumed.

let root: string
let bundle: string
let logsDir: string

beforeAll(async () => {
  root = await realpath(mkdtempSync(join(tmpdir(), 'orca-usage-scan-child-')))
  bundle = join(root, 'relay-usage-scan.js')
  await build({
    entryPoints: [join(__dirname, 'usage-scan-entry.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: bundle,
    external: ['electron'],
    logLevel: 'silent'
  })
  logsDir = join(root, 'trae-home')
  mkdirSync(logsDir, { recursive: true })
  writeFileSync(
    join(logsDir, 'session.jsonl'),
    `${JSON.stringify({
      type: 'token_usage_record',
      // 20:00Z is already the 11th in Tokyo and still the 10th in Los Angeles.
      timestamp: '2026-06-10T20:00:00Z',
      request_id: 'r1',
      model: 'kimi-k2',
      usage: { input_tokens: 100, output_tokens: 20 }
    })}\n`
  )
}, 60_000)

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

const daysOf = (output: Awaited<ReturnType<typeof runUsageScanInChild>>): string[] =>
  output.files.flatMap((file) =>
    file.dailyAggregates.map((row) =>
      typeof row === 'object' && row !== null && 'day' in row ? String(row.day) : ''
    )
  )

function scan(timeZone: string, cacheName: string) {
  return runUsageScanInChild(
    { cli: 'trae', worktrees: [], timeZone, cacheFile: join(root, cacheName) },
    undefined,
    bundle
  )
}

describe('the forked usage scan child', () => {
  it('buckets days in the viewer’s time zone, not the host’s', async () => {
    vi.stubEnv('ORCA_TRAE_USAGE_ROOTS', logsDir)
    expect(daysOf(await scan('Asia/Tokyo', 'tokyo.json'))).toEqual(['2026-06-11'])
    expect(daysOf(await scan('America/Los_Angeles', 'la.json'))).toEqual(['2026-06-10'])
  }, 60_000)

  it('is not affected by an ambient NODE_OPTIONS, which the environment allowlist drops', async () => {
    vi.stubEnv('ORCA_TRAE_USAGE_ROOTS', logsDir)
    vi.stubEnv('NODE_OPTIONS', '--require /definitely/not/there.js')
    await expect(scan('UTC', 'env.json')).resolves.toMatchObject({ files: [expect.anything()] })
  }, 60_000)

  it('sends back aggregates only, with no log path', async () => {
    vi.stubEnv('ORCA_TRAE_USAGE_ROOTS', logsDir)
    expect(JSON.stringify(await scan('UTC', 'privacy.json'))).not.toContain(root)
  }, 60_000)

  it('fails with the child’s message when the CLI has no scanner', async () => {
    await expect(
      runUsageScanInChild(
        { cli: 'nope', worktrees: [], timeZone: 'UTC', cacheFile: join(root, 'x.json') },
        undefined,
        bundle
      )
    ).rejects.toThrow(/No usage scanner/)
  }, 60_000)

  it('stops the child when the request is cancelled', async () => {
    const controller = new AbortController()
    const pending = runUsageScanInChild(
      { cli: 'trae', worktrees: [], timeZone: 'UTC', cacheFile: join(root, 'abort.json') },
      controller.signal,
      bundle
    )
    controller.abort()
    await expect(pending).rejects.toThrow(/cancelled/)
  }, 60_000)
})

describe('buildRelayUsageScanEnv', () => {
  it('keeps the CLI roots, sets the zone, and drops everything else', () => {
    const env = buildRelayUsageScanEnv(
      'Asia/Tokyo',
      {
        PATH: '/usr/bin',
        HOME: '/home/u',
        TZ: 'UTC',
        CLAUDE_CONFIG_DIR: '/cfg',
        CODEX_HOME: '/codex',
        NODE_OPTIONS: '--require x',
        AWS_SECRET_ACCESS_KEY: 'secret'
      },
      'linux'
    )
    expect(env).toMatchObject({
      PATH: '/usr/bin',
      HOME: '/home/u',
      TZ: 'Asia/Tokyo',
      CLAUDE_CONFIG_DIR: '/cfg',
      CODEX_HOME: '/codex'
    })
    expect(env).not.toHaveProperty('NODE_OPTIONS')
    expect(env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
  })
})
