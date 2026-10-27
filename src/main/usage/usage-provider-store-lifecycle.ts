import { existsSync, readFileSync } from 'node:fs'
import { AgentTokenUsageReporter } from './agent-token-usage-reporter'
import type { AgentTokenSession } from './agent-token-usage'
import type { AgentTokenUsage } from '../../shared/telemetry-agent-token-usage-schema'
import { isTelemetryEnabled } from '../telemetry/client'
import { join, parse } from 'node:path'
import { AnalyticsSessionIdStore, type AnalyticsSessionId } from './analytics-session-id-store'
import type { Store } from '../persistence'
import { UsageCacheSnapshotWriter } from '../usage-cache-snapshot-writer'
import { loadKnownUsageWorktreesByRepo } from '../usage-worktree-metadata'
import type { UsageScanWorktreeRef } from './usage-provider-contract'
import { createWorktreeRefs, getUsageWorktreeFingerprint } from './usage-worktree-refs'
import { LOCAL_USAGE_HOST_ID, type UsageRow, type UsageSessionRef } from './query/unified-usage-row'
import { usageFileDigest } from './hosts/usage-file-digest'

const STALE_MS = 5 * 60_000

type UsageProviderScanState = {
  enabled: boolean
  lastScanStartedAt: number | null
  lastScanCompletedAt: number | null
  lastScanError: string | null
}

type UsageProviderStoreState<SourceKey extends string> = {
  worktreeFingerprint: string | null
  sessions: unknown[]
  dailyAggregates: unknown[]
  scanState: UsageProviderScanState
} & Record<SourceKey, unknown[]>

type UsageProviderScanProjection<
  SourceKey extends string,
  State extends UsageProviderStoreState<SourceKey>
> = Pick<State, SourceKey | 'sessions' | 'dailyAggregates'>

/** A store's contribution to the cross-CLI query, in CLI-neutral rows. */
export type UnifiedUsageData = { rows: UsageRow[]; sessions: UsageSessionRef[] }

/** One source file's rows. The digest names its contents so a copy on another host can be spotted. */
export type UnifiedUsageFile = UnifiedUsageData & { digest: string | null }

type UsageProviderStoreLifecycleConfig<
  SourceKey extends string,
  State extends UsageProviderStoreState<SourceKey>,
  DataPresenceKey extends string
> = {
  logTag: string
  /** The adapter id this store reports under in the cross-CLI query. */
  cli: string
  /** Maps this CLI's own aggregates into unified rows, applying its token semantics. */
  unify: (state: State, hostId: string) => UnifiedUsageData
  /** The per-file slices of the cache: what each file contributed and which events it owns. */
  files: (state: State) => {
    ownedKeys: readonly string[]
    slice: Pick<State, 'sessions' | 'dailyAggregates'>
  }[]
  resolveCacheFile: () => string
  createDefaultState: () => State
  normalizeState: (state: State) => State
  sourceKey: SourceKey
  dataPresenceKey: DataPresenceKey
  jsonIndent?: number
  tokenUsage?: {
    provider: AgentTokenUsage['provider']
    selectSessions: (state: State) => AgentTokenSession[]
  }
  scan: (
    worktrees: UsageScanWorktreeRef[],
    previous: State[SourceKey]
  ) => Promise<UsageProviderScanProjection<SourceKey, State>>
}

type PublicUsageProviderScanState<DataPresenceKey extends string> = UsageProviderScanState & {
  isScanning: boolean
} & Record<DataPresenceKey, boolean>

export abstract class UsageProviderStoreLifecycle<
  SourceKey extends string,
  State extends UsageProviderStoreState<SourceKey>,
  DataPresenceKey extends string
> {
  protected state: State
  private scanPromise: Promise<void> | null = null
  private tokenReporter: AgentTokenUsageReporter | null = null
  private analyticsSessionIds: AnalyticsSessionIdStore | null = null
  private readonly writer: UsageCacheSnapshotWriter

  constructor(
    private readonly store: Pick<Store, 'getRepos' | 'getAllWorktreeMeta'>,
    private readonly config: UsageProviderStoreLifecycleConfig<SourceKey, State, DataPresenceKey>
  ) {
    this.writer = new UsageCacheSnapshotWriter(config.logTag, config.resolveCacheFile)
    this.state = this.load()
  }

  getScanState(): PublicUsageProviderScanState<DataPresenceKey> {
    return {
      ...this.state.scanState,
      isScanning: this.scanPromise !== null,
      [this.config.dataPresenceKey]:
        this.state.sessions.length > 0 || this.state.dailyAggregates.length > 0
    } as PublicUsageProviderScanState<DataPresenceKey>
  }

  getCliId(): string {
    return this.config.cli
  }

  isEnabled(): boolean {
    return this.state.scanState.enabled
  }

  /**
   * Local rows, one entry per source file. Turning collection off stops new scans but keeps the
   * history, so it still counts here; leaving a CLI out of a total is a separate, explicit choice.
   */
  getUnifiedUsageFiles(hostId = LOCAL_USAGE_HOST_ID): UnifiedUsageFile[] {
    return this.config.files(this.state).map((file) => ({
      digest: usageFileDigest(file.ownedKeys),
      ...this.config.unify({ ...this.state, ...file.slice }, hostId)
    }))
  }

  /**
   * Maps a source file read from another machine into rows, with this CLI's token semantics.
   * The data is untrusted and shaped like this CLI's own cache, so a mapper that throws on it is
   * the caller's cue to reject the file, and the rows must be sanitized before they count.
   */
  unifyForeignFile(
    hostId: string,
    file: { sessions: unknown[]; dailyAggregates: unknown[] }
  ): UnifiedUsageData {
    return this.config.unify(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mapper only reads fields off these arrays, throws on a shape it cannot read, and its rows go through sanitizeUnifiedUsage before they count.
      { ...this.state, sessions: file.sessions, dailyAggregates: file.dailyAggregates } as State,
      hostId
    )
  }

  /** Local identity only; callers must use the usage store on the execution host. */
  getAnalyticsSessionIds(providerSessionIds: readonly string[]): Promise<AnalyticsSessionId[]> {
    if (!this.analyticsSessionIds) {
      const { dir, name } = parse(this.config.resolveCacheFile())
      this.analyticsSessionIds = new AnalyticsSessionIdStore(
        join(dir, `${name}-analytics-session-ids.json`)
      )
    }
    return this.analyticsSessionIds.getOrCreate(providerSessionIds)
  }

  /** Await queued cache writes so quit does not drop the final snapshot. */
  async flush(): Promise<void> {
    await this.tokenReporter?.flush()
    await Promise.all([this.writer.flush(), this.analyticsSessionIds?.flush()])
  }

  async setEnabled(enabled: boolean): Promise<PublicUsageProviderScanState<DataPresenceKey>> {
    this.state.scanState.enabled = enabled
    await this.writeToDisk()
    return this.getScanState()
  }

  async refresh(force = false): Promise<PublicUsageProviderScanState<DataPresenceKey>> {
    if (!this.state.scanState.enabled) {
      return this.getScanState()
    }
    const currentWorktreeFingerprint = await this.getCurrentWorktreeFingerprint()
    if (!force && this.state.scanState.lastScanCompletedAt) {
      const ageMs = Date.now() - this.state.scanState.lastScanCompletedAt
      if (ageMs < STALE_MS && this.state.worktreeFingerprint === currentWorktreeFingerprint) {
        return this.getScanState()
      }
    }
    await this.runScan()
    return this.getScanState()
  }

  protected writeToDisk(): Promise<void> {
    return this.writer.write(() => JSON.stringify(this.state, null, this.config.jsonIndent))
  }

  private load(): State {
    const defaults = this.config.createDefaultState()
    try {
      const cacheFile = this.config.resolveCacheFile()
      if (!existsSync(cacheFile)) {
        return defaults
      }
      const parsed = JSON.parse(readFileSync(cacheFile, 'utf-8')) as State
      return this.config.normalizeState({
        ...defaults,
        ...parsed,
        scanState: { ...defaults.scanState, ...parsed.scanState }
      })
    } catch (error) {
      console.error(`${this.config.logTag} Failed to load persisted state, starting fresh:`, error)
      return defaults
    }
  }

  private async runScan(): Promise<void> {
    if (this.scanPromise) {
      await this.scanPromise
      return
    }

    this.state.scanState.lastScanStartedAt = Date.now()
    this.state.scanState.lastScanError = null

    // Assign before yielding so concurrent refreshes share one scan.
    this.scanPromise = (async () => {
      try {
        const repos = this.store.getRepos()
        const worktreesByRepo = loadKnownUsageWorktreesByRepo(this.store, repos)
        const worktreeFingerprint = getUsageWorktreeFingerprint(worktreesByRepo)
        const result = await this.config.scan(
          createWorktreeRefs(repos, worktreesByRepo),
          this.state.worktreeFingerprint === worktreeFingerprint
            ? this.state[this.config.sourceKey]
            : this.config.createDefaultState()[this.config.sourceKey]
        )
        this.state[this.config.sourceKey] = result[this.config.sourceKey]
        this.state.sessions = result.sessions
        this.state.dailyAggregates = result.dailyAggregates
        this.state.worktreeFingerprint = worktreeFingerprint
        this.state.scanState.lastScanCompletedAt = Date.now()
        this.state.scanState.lastScanError = null
        // Persistence failures do not turn a successful source scan into a scan failure.
        await this.writeToDisk().catch(() => {})
        await this.reportTokenUsage()
      } catch (error) {
        this.state.scanState.lastScanError = error instanceof Error ? error.message : String(error)
        await this.writeToDisk().catch(() => {})
      } finally {
        this.scanPromise = null
      }
    })()

    await this.scanPromise
  }

  private async reportTokenUsage(): Promise<void> {
    const config = this.config.tokenUsage
    if (!config || !isTelemetryEnabled() || !this.state.scanState.enabled) {
      return
    }
    try {
      if (!this.tokenReporter) {
        const { dir, name } = parse(this.config.resolveCacheFile())
        this.tokenReporter = new AgentTokenUsageReporter(
          join(dir, `${name}-token-usage.json`),
          config.provider,
          (ids) => this.getAnalyticsSessionIds(ids)
        )
      }
      await this.tokenReporter.report(config.selectSessions(this.state))
    } catch {
      // Reporting failures must not invalidate a successful local usage scan.
      console.warn(
        '[agent-token-usage] Could not report token usage; will retry after the next scan'
      )
    }
  }

  private async getCurrentWorktreeFingerprint(): Promise<string> {
    const repos = this.store.getRepos()
    return getUsageWorktreeFingerprint(loadKnownUsageWorktreesByRepo(this.store, repos))
  }
}
