import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { scanClaudeUsageFiles } from '../main/claude-usage/scanner'
import type { ClaudeUsagePersistedFile } from '../main/claude-usage/types'
import { scanCodexUsageFiles } from '../main/codex-usage/scanner'
import type { CodexUsagePersistedFile } from '../main/codex-usage/types'
import { scanTraeUsageFiles } from '../main/trae-usage/scanner'
import type { TraeUsagePersistedFile } from '../main/trae-usage/types'
import { usageFileDigest } from '../main/usage/hosts/usage-file-digest'
import type { UsageScanWorktreeRef } from '../main/usage/usage-provider-contract'
import type { UsageScanOutput, UsageScanRelayWorktree } from '../shared/usage-scan-relay'

/**
 * One remote usage scan, run in a short-lived child process so the relay's event loop (and every
 * terminal on it) is never blocked and the viewer's time zone can be set for the whole scan.
 * Imports must stay electron-free: this bundle runs on hosts that have no Electron.
 */

const CACHE_VERSION = 1

type ProcessedFile = {
  path: string
  mtimeMs: number
  size: number
  sessions: unknown[]
  dailyAggregates: unknown[]
}

function hasProcessedFileShape(value: unknown): value is ProcessedFile {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return (
    'path' in value &&
    typeof value.path === 'string' &&
    'mtimeMs' in value &&
    typeof value.mtimeMs === 'number' &&
    'size' in value &&
    typeof value.size === 'number' &&
    'sessions' in value &&
    Array.isArray(value.sessions) &&
    'dailyAggregates' in value &&
    Array.isArray(value.dailyAggregates)
  )
}

function hasArrayField(value: object, key: string): boolean {
  return key in value && Array.isArray(Reflect.get(value, key))
}

/** A cached file beside the event keys it owns, which stay on the host and only become a digest. */
type ScannedFile = { file: ProcessedFile; ownedKeys: readonly string[] }

export type RelayUsageScanner = {
  scan(worktrees: UsageScanWorktreeRef[], previous: unknown[]): Promise<ScannedFile[]>
}

function defineScanner<TFile extends ProcessedFile>(config: {
  isFile: (value: unknown) => value is TFile
  scan: (worktrees: UsageScanWorktreeRef[], previous: TFile[]) => Promise<TFile[]>
  ownedKeys: (file: TFile) => readonly string[]
}): RelayUsageScanner {
  return {
    async scan(worktrees, previous) {
      const processed = await config.scan(worktrees, previous.filter(config.isFile))
      return processed.map((file) => ({ file, ownedKeys: config.ownedKeys(file) }))
    }
  }
}

export const RELAY_USAGE_SCANNERS: Record<string, RelayUsageScanner> = {
  claude: defineScanner<ClaudeUsagePersistedFile>({
    isFile: (value): value is ClaudeUsagePersistedFile =>
      hasProcessedFileShape(value) && hasArrayField(value, 'ownedDedupeKeys'),
    scan: async (worktrees, previous) =>
      (await scanClaudeUsageFiles(worktrees, previous)).processedFiles,
    ownedKeys: (file) => file.ownedDedupeKeys
  }),
  codex: defineScanner<CodexUsagePersistedFile>({
    isFile: (value): value is CodexUsagePersistedFile =>
      hasProcessedFileShape(value) && hasArrayField(value, 'ownedEventKeys'),
    scan: async (worktrees, previous) =>
      (await scanCodexUsageFiles(worktrees, previous)).processedFiles,
    ownedKeys: (file) => file.ownedEventKeys
  }),
  trae: defineScanner<TraeUsagePersistedFile>({
    isFile: (value): value is TraeUsagePersistedFile =>
      hasProcessedFileShape(value) && hasArrayField(value, 'ownedEventKeys'),
    scan: async (worktrees, previous) =>
      (await scanTraeUsageFiles(worktrees, previous)).processedFiles,
    ownedKeys: (file) => file.ownedEventKeys
  })
}

export type UsageScanJobInput = {
  cli: string
  worktrees: UsageScanRelayWorktree[]
  timeZone: string
  /** Where this host keeps its incremental cache for the CLI. */
  cacheFile: string
}

export type UsageScanJobOutput = UsageScanOutput

type UsageScanCache = {
  version: number
  timeZone: string
  worktreeFingerprint: string
  processedFiles: unknown[]
}

function fingerprintWorktrees(worktrees: readonly UsageScanRelayWorktree[]): string {
  return JSON.stringify(
    worktrees
      .map((worktree) => [
        worktree.repoId,
        worktree.worktreeId,
        worktree.path,
        worktree.displayName
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  )
}

async function readCache(cacheFile: string): Promise<UsageScanCache | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(cacheFile, 'utf-8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'version' in parsed &&
      parsed.version === CACHE_VERSION &&
      'timeZone' in parsed &&
      typeof parsed.timeZone === 'string' &&
      'worktreeFingerprint' in parsed &&
      typeof parsed.worktreeFingerprint === 'string' &&
      'processedFiles' in parsed &&
      Array.isArray(parsed.processedFiles)
    ) {
      return {
        version: CACHE_VERSION,
        timeZone: parsed.timeZone,
        worktreeFingerprint: parsed.worktreeFingerprint,
        processedFiles: parsed.processedFiles
      }
    }
  } catch {
    // Missing or corrupt: a full rescan is the safe answer.
  }
  return null
}

async function writeCache(cacheFile: string, cache: UsageScanCache): Promise<void> {
  await mkdir(dirname(cacheFile), { recursive: true })
  const temp = `${cacheFile}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(cache), 'utf-8')
  await rename(temp, cacheFile)
}

export async function runUsageScanJob(
  input: UsageScanJobInput,
  scanners: Record<string, RelayUsageScanner> = RELAY_USAGE_SCANNERS
): Promise<UsageScanJobOutput> {
  const scanner = scanners[input.cli]
  if (!scanner) {
    throw new Error(`No usage scanner for ${input.cli}`)
  }
  const worktreeFingerprint = fingerprintWorktrees(input.worktrees)
  const cache = await readCache(input.cacheFile)
  // Days and attribution both depend on these, so a change makes every cached file stale.
  const previous =
    cache && cache.timeZone === input.timeZone && cache.worktreeFingerprint === worktreeFingerprint
      ? cache.processedFiles
      : []
  const scanned = await scanner.scan(input.worktrees, previous)

  // Best effort: a cache that cannot be written only costs the next scan its speed.
  await writeCache(input.cacheFile, {
    version: CACHE_VERSION,
    timeZone: input.timeZone,
    worktreeFingerprint,
    processedFiles: scanned.map((entry) => entry.file)
  }).catch(() => {})

  const revision = createHash('sha1')
    .update(JSON.stringify([input.timeZone, worktreeFingerprint]))
    .update(JSON.stringify(scanned.map(({ file }) => [file.path, file.mtimeMs, file.size]).sort()))
    .digest('hex')

  return {
    revision,
    scannedAt: Date.now(),
    files: scanned
      .filter(({ file }) => file.sessions.length > 0 || file.dailyAggregates.length > 0)
      .map(({ file, ownedKeys }) => ({
        digest: usageFileDigest(ownedKeys),
        sessions: file.sessions,
        dailyAggregates: file.dailyAggregates
      }))
  }
}
