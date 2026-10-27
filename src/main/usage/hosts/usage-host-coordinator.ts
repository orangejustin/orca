import { toSshExecutionHostId } from '../../../shared/execution-host'
import { USAGE_ADAPTER_CATALOG } from '../../../shared/usage-adapter-catalog'
import { isUsageScanRelayCli, type UsageScanRelayWorktree } from '../../../shared/usage-scan-relay'
import type {
  UsageHostCliCoverage,
  UsageHostCoverage,
  UsageHostStatus
} from '../../../shared/usage-service-types'
import type { UsageAdapterStore } from '../usage-adapter-registry'
import type { HostUsageFile } from './usage-host-merge'
import type { RemoteCliUsage, RemoteUsageCache } from './remote-usage-cache'
import {
  describeFailure,
  readRemainingUsagePages,
  requestUsageScanPage,
  StaleScanResultError,
  type UsageHostMux
} from './remote-usage-scan-request'
import { sanitizeUnifiedUsage } from './sanitize-unified-usage'

export type { UsageHostMux }

export type UsageHostCoordinatorDeps = {
  cache: RemoteUsageCache
  /** Registered SSH targets Orca can show; runtime-owned ones are not listed. */
  listTargets(): { id: string; label: string }[]
  /** The live channel for a target, or undefined when it is not connected. */
  getMux(targetId: string): UsageHostMux | undefined
  /** The target's own worktrees, as paths on that host. */
  getHostWorktrees(targetId: string): UsageScanRelayWorktree[]
  getStores(): ReadonlyMap<string, UsageAdapterStore>
  timeZone(): string
  now(): number
  /** Distinguishes an error code from the JSON-RPC layer, which is the one that means "no such method". */
  isMethodNotFound(error: unknown): boolean
  /** True when a request may have run on the host although its answer never arrived. */
  isOutcomeUnverifiable(error: unknown): boolean
}

type LiveStatus = { status: UsageHostStatus; message: string | null; attemptedAt: number }

export type UsageHostSyncArgs = {
  hostIds?: string[]
  clis?: string[]
  signal?: AbortSignal
}

/**
 * Keeps a per-host, per-CLI copy of what each SSH host reported about its own CLI logs, and says
 * honestly how fresh each copy is. A host that cannot be reached keeps its last result and is
 * marked stale; it is never shown as zero (docs/reference/ssh-execution-boundary.md).
 */
export class UsageHostCoordinator {
  private readonly live = new Map<string, LiveStatus>()
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly mappedFiles = new WeakMap<RemoteCliUsage, HostUsageFile[]>()
  private droppedRows = 0

  constructor(private readonly deps: UsageHostCoordinatorDeps) {}

  /** CLIs a remote host can be asked about: scannable remotely and with a local adapter. */
  private remoteClis(): string[] {
    const stores = this.deps.getStores()
    return USAGE_ADAPTER_CATALOG.filter(
      (entry) => entry.remoteScan && isUsageScanRelayCli(entry.id) && stores.has(entry.id)
    ).map((entry) => entry.id)
  }

  getHostOrder(): string[] {
    return this.deps
      .listTargets()
      .map((target) => toSshExecutionHostId(target.id))
      .sort()
  }

  getHostLabels(): Record<string, string> {
    return Object.fromEntries(
      this.deps.listTargets().map((target) => [toSshExecutionHostId(target.id), target.label])
    )
  }

  /** Files from every registered host's last good result, mapped into unified rows. */
  getFiles(): HostUsageFile[] {
    const timeZone = this.deps.timeZone()
    const files: HostUsageFile[] = []
    for (const target of this.deps.listTargets()) {
      const hostId = toSshExecutionHostId(target.id)
      for (const cli of this.remoteClis()) {
        const entry = this.deps.cache.get(hostId, cli)
        // Days recorded in another zone would land on the wrong side of a boundary.
        if (entry && entry.timeZone === timeZone) {
          files.push(...this.mapEntry(hostId, cli, entry))
        }
      }
    }
    return files
  }

  getDroppedRowCount(): number {
    return this.droppedRows
  }

  getCoverage(): UsageHostCoverage[] {
    const timeZone = this.deps.timeZone()
    return this.deps.listTargets().map((target) => {
      const hostId = toSshExecutionHostId(target.id)
      const clis: UsageHostCliCoverage[] = USAGE_ADAPTER_CATALOG.map((catalog) => {
        if (!this.remoteClis().includes(catalog.id)) {
          return {
            cli: catalog.id,
            status: 'unsupported',
            lastSuccessAt: null,
            message: 'Not scanned on remote hosts yet.'
          }
        }
        return this.coverageFor(hostId, catalog.id, timeZone)
      })
      return { hostId, label: target.label, clis }
    })
  }

  /** Syncs the chosen hosts, or every connected one. Concurrent calls for a host share one run. */
  async sync(args: UsageHostSyncArgs = {}): Promise<void> {
    const targets = this.deps
      .listTargets()
      .filter((target) => !args.hostIds || args.hostIds.includes(toSshExecutionHostId(target.id)))
    await this.pruneRemovedHosts()
    await Promise.all(
      targets.map((target) => {
        const key = toSshExecutionHostId(target.id)
        const running = this.inFlight.get(key)
        if (running) {
          return running
        }
        const run = this.syncHost(target, args).finally(() => this.inFlight.delete(key))
        this.inFlight.set(key, run)
        return run
      })
    )
  }

  private coverageFor(hostId: string, cli: string, timeZone: string): UsageHostCliCoverage {
    const entry = this.deps.cache.get(hostId, cli)
    const live = this.live.get(this.key(hostId, cli))
    const lastSuccessAt = entry?.lastSuccessAt ?? null
    if (entry && entry.timeZone !== timeZone) {
      return {
        cli,
        status: 'stale',
        lastSuccessAt,
        message: 'Recorded in another time zone. Sync to realign the days.'
      }
    }
    if (live) {
      // Data from an earlier sync survives a failure, so a failed refresh reads as stale.
      const status = entry && live.status === 'unavailable' ? 'stale' : live.status
      return { cli, status, lastSuccessAt, message: live.message }
    }
    return entry
      ? {
          cli,
          status: 'stale',
          lastSuccessAt,
          message: 'Not refreshed since Orca started.'
        }
      : { cli, status: 'never-synced', lastSuccessAt: null, message: null }
  }

  private key(hostId: string, cli: string): string {
    return `${hostId}\u0000${cli}`
  }

  private mapEntry(hostId: string, cli: string, entry: RemoteCliUsage): HostUsageFile[] {
    const memo = this.mappedFiles.get(entry)
    if (memo) {
      return memo
    }
    const store = this.deps.getStores().get(cli)
    const mapped: HostUsageFile[] = []
    if (store) {
      for (const file of entry.files) {
        try {
          const clean = sanitizeUnifiedUsage(store.unifyForeignFile(hostId, file))
          this.droppedRows += clean.droppedRows
          mapped.push({
            hostId,
            cli,
            digest: file.digest,
            rows: clean.rows,
            sessions: clean.sessions
          })
        } catch {
          // A file this CLI's mapper cannot read is left out; the host's other files still count.
          this.droppedRows += 1
        }
      }
    }
    this.mappedFiles.set(entry, mapped)
    return mapped
  }

  private async pruneRemovedHosts(): Promise<void> {
    const known = new Set<string>(
      this.deps.listTargets().map((target) => toSshExecutionHostId(target.id))
    )
    for (const hostId of this.deps.cache.listHostIds()) {
      if (!known.has(hostId)) {
        await this.deps.cache.forget(hostId)
      }
    }
  }

  private async syncHost(
    target: { id: string; label: string },
    args: UsageHostSyncArgs
  ): Promise<void> {
    const hostId = toSshExecutionHostId(target.id)
    for (const cli of this.remoteClis()) {
      if (!args.clis || args.clis.includes(cli)) {
        await this.syncCli(target, hostId, cli, args.signal)
      }
    }
  }

  private setLive(hostId: string, cli: string, status: UsageHostStatus, message: string | null) {
    this.live.set(this.key(hostId, cli), { status, message, attemptedAt: this.deps.now() })
  }

  private async syncCli(
    target: { id: string; label: string },
    hostId: string,
    cli: string,
    signal?: AbortSignal
  ): Promise<void> {
    let mux: UsageHostMux | undefined
    try {
      mux = this.deps.getMux(target.id)
    } catch (error) {
      // No SSH layer is a wiring state, not a connection state; say so rather than guess.
      this.setLive(hostId, cli, 'unavailable', describeFailure(error))
      return
    }
    if (!mux || mux.isDisposed()) {
      this.setLive(hostId, cli, 'unavailable', 'The host is not connected.')
      return
    }
    try {
      await this.fetchAndStore(mux, target, hostId, cli, signal)
    } catch (error) {
      this.recordFailure(hostId, cli, error)
    }
  }

  private recordFailure(hostId: string, cli: string, error: unknown): void {
    if (this.deps.isMethodNotFound(error)) {
      this.setLive(
        hostId,
        cli,
        'unsupported',
        'This host’s relay cannot scan usage. Reconnect the host to deploy the current relay.'
      )
    } else if (this.deps.isOutcomeUnverifiable(error)) {
      this.setLive(
        hostId,
        cli,
        'unavailable',
        'No answer from the host (timed out or the connection dropped). Its usage is unknown, not zero.'
      )
    } else {
      this.setLive(hostId, cli, 'unavailable', describeFailure(error))
    }
  }

  private async fetchAndStore(
    mux: UsageHostMux,
    target: { id: string; label: string },
    hostId: string,
    cli: string,
    signal?: AbortSignal
  ): Promise<void> {
    const timeZone = this.deps.timeZone()
    const known = this.deps.cache.get(hostId, cli)
    const base = {
      cli,
      timeZone,
      worktrees: this.deps.getHostWorktrees(target.id),
      knownRevision: known && known.timeZone === timeZone ? known.revision : null
    }
    // A result replaced mid-read cannot be stitched from two scans; start over once.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const first = await requestUsageScanPage(mux, base, signal)
        if (first.kind === 'unsupported-cli') {
          this.setLive(hostId, cli, 'unsupported', 'This host’s relay does not scan this CLI.')
          return
        }
        if (first.kind === 'not-modified') {
          await this.deps.cache.touch(hostId, cli, this.deps.now())
          this.setLive(hostId, cli, 'ok', null)
          return
        }
        const files = await readRemainingUsagePages(mux, base, first, signal)
        await this.deps.cache.set(hostId, target.label, cli, {
          revision: first.revision,
          timeZone: first.timeZone,
          lastSuccessAt: this.deps.now(),
          files
        })
        this.setLive(hostId, cli, 'ok', null)
        return
      } catch (error) {
        if (!(error instanceof StaleScanResultError) || attempt === 1) {
          throw error
        }
      }
    }
  }
}
