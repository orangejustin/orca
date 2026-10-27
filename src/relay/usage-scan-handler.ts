import { readFileSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { RELAY_REMOTE_DIR } from '../main/ssh/relay-protocol'
import {
  isUsageScanRelayCli,
  USAGE_SCAN_RELAY_MAX_WORKTREES,
  USAGE_SCAN_RELAY_METHOD,
  USAGE_SCAN_RELAY_PAGE_BYTES,
  type UsageScanOutput,
  type UsageScanRelayFile,
  type UsageScanRelayParams,
  type UsageScanRelayResult,
  type UsageScanRelayWorktree
} from '../shared/usage-scan-relay'
import type { RelayDispatcher } from './dispatcher'
import { relayLogLine } from './relay-diagnostic-log'
import type { UsageScanJobInput } from './usage-scan-job'
import { runUsageScanInChild } from './usage-scan-spawn'

const MAX_FIELD_LENGTH = 4096
const USAGE_CACHE_DIR = 'usage-cache'

export type UsageScanRunner = (
  input: UsageScanJobInput,
  signal?: AbortSignal
) => Promise<UsageScanOutput>

type UsageScanHandlerOptions = {
  /** Where this host keeps relay data; defaults to ~/.orca-remote. */
  dataRoot?: string
  /** Identifies this relay build, so a newer relay never reads a cache shaped by an older one. */
  version?: string
  run?: UsageScanRunner
}

type HeldResult = UsageScanOutput & { cli: string; timeZone: string }

function readRelayVersion(): string {
  try {
    return readFileSync(join(__dirname, '.version'), 'utf-8').trim() || 'unversioned'
  } catch {
    return 'unversioned'
  }
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

function boundedString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH
    ? value
    : null
}

function normalizeWorktrees(value: unknown): UsageScanRelayWorktree[] {
  if (!Array.isArray(value)) {
    return []
  }
  const worktrees: UsageScanRelayWorktree[] = []
  for (const entry of value.slice(0, USAGE_SCAN_RELAY_MAX_WORKTREES)) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const repoId = boundedString('repoId' in entry ? entry.repoId : null)
    const worktreeId = boundedString('worktreeId' in entry ? entry.worktreeId : null)
    const path = boundedString('path' in entry ? entry.path : null)
    const displayName = boundedString('displayName' in entry ? entry.displayName : null)
    if (repoId && worktreeId && path && displayName) {
      worktrees.push({ repoId, worktreeId, path, displayName })
    }
  }
  return worktrees
}

function normalizePage(value: unknown): UsageScanRelayParams['page'] {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const revision = boundedString('revision' in value ? value.revision : null)
  const offset = 'offset' in value ? value.offset : null
  return revision && typeof offset === 'number' && Number.isInteger(offset) && offset >= 0
    ? { revision, offset }
    : undefined
}

export function normalizeUsageScanParams(params: Record<string, unknown>): UsageScanRelayParams {
  const cli = boundedString(params.cli)
  const timeZone = boundedString(params.timeZone)
  if (!cli) {
    throw new Error('usage.scan requires a cli')
  }
  if (!timeZone || !isValidTimeZone(timeZone)) {
    throw new Error('usage.scan requires a valid IANA time zone')
  }
  return {
    cli,
    timeZone,
    worktrees: normalizeWorktrees(params.worktrees),
    knownRevision: boundedString(params.knownRevision),
    page: normalizePage(params.page)
  }
}

/** Cuts a result into pages by encoded size, always taking at least one file per page. */
function sliceFiles(
  files: readonly UsageScanRelayFile[],
  offset: number
): { files: UsageScanRelayFile[]; nextOffset: number | null } {
  const page: UsageScanRelayFile[] = []
  let bytes = 0
  let index = offset
  while (index < files.length) {
    const size = JSON.stringify(files[index]).length
    if (page.length > 0 && bytes + size > USAGE_SCAN_RELAY_PAGE_BYTES) {
      break
    }
    page.push(files[index])
    bytes += size
    index++
  }
  return { files: page, nextOffset: index < files.length ? index : null }
}

export class UsageScanHandler {
  private readonly held = new Map<string, HeldResult>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly dataRoot: string
  private readonly version: string
  private readonly run: UsageScanRunner
  private prunedOldCaches = false

  constructor(dispatcher: RelayDispatcher, options: UsageScanHandlerOptions = {}) {
    this.dataRoot = options.dataRoot ?? join(homedir(), RELAY_REMOTE_DIR)
    this.version = (options.version ?? readRelayVersion()).replace(/[^\w.+-]/g, '_')
    this.run = options.run ?? runUsageScanInChild
    dispatcher.onRequest(USAGE_SCAN_RELAY_METHOD, (params, context) =>
      this.handle(normalizeUsageScanParams(params), context.signal)
    )
  }

  async handle(params: UsageScanRelayParams, signal?: AbortSignal): Promise<UsageScanRelayResult> {
    if (!isUsageScanRelayCli(params.cli)) {
      // Reported, not thrown: a host that lacks a CLI is a coverage gap, not a failed host.
      return { kind: 'unsupported-cli', cli: params.cli }
    }
    if (params.page) {
      return this.servePage(params.cli, params.page.revision, params.page.offset)
    }
    return this.enqueue(params.cli, async () => {
      void this.pruneOldCaches()
      const output = await this.run(
        {
          cli: params.cli,
          worktrees: params.worktrees,
          timeZone: params.timeZone,
          cacheFile: join(this.dataRoot, USAGE_CACHE_DIR, this.version, `${params.cli}.json`)
        },
        signal
      )
      this.held.set(params.cli, { ...output, cli: params.cli, timeZone: params.timeZone })
      if (params.knownRevision && params.knownRevision === output.revision) {
        return { kind: 'not-modified', revision: output.revision } satisfies UsageScanRelayResult
      }
      return this.servePage(params.cli, output.revision, 0)
    })
  }

  private servePage(cli: string, revision: string, offset: number): UsageScanRelayResult {
    const held = this.held.get(cli)
    if (!held || held.revision !== revision) {
      throw new Error('Usage scan result changed while it was being read; start the sync again')
    }
    const page = sliceFiles(held.files, offset)
    return {
      kind: 'page',
      cli,
      revision,
      timeZone: held.timeZone,
      scannedAt: held.scannedAt,
      offset,
      nextOffset: page.nextOffset,
      totalFiles: held.files.length,
      files: page.files
    }
  }

  /** Scans of one CLI never overlap: they share a cache file and the same logs. */
  private enqueue<T>(cli: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(cli) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.queues.set(
      cli,
      next.catch(() => {})
    )
    return next
  }

  private async pruneOldCaches(): Promise<void> {
    if (this.prunedOldCaches) {
      return
    }
    this.prunedOldCaches = true
    const root = join(this.dataRoot, USAGE_CACHE_DIR)
    try {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== this.version) {
          await rm(join(root, entry.name), { recursive: true, force: true })
        }
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        relayLogLine(
          `[relay] usage cache cleanup failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }
}
