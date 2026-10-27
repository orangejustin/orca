import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import { usageScanRelayFileSchema, type UsageScanRelayFile } from '../../../shared/usage-scan-relay'
import { UsageCacheSnapshotWriter } from '../../usage-cache-snapshot-writer'

const cliEntrySchema = z.object({
  revision: z.string(),
  timeZone: z.string(),
  lastSuccessAt: z.number(),
  files: z.array(usageScanRelayFileSchema)
})

const persistedSchema = z.object({
  version: z.literal(1),
  hosts: z.record(
    z.string(),
    z.object({ label: z.string(), clis: z.record(z.string(), cliEntrySchema) })
  )
})

export type RemoteCliUsage = z.infer<typeof cliEntrySchema> & { files: UsageScanRelayFile[] }

type HostEntry = { label: string; clis: Map<string, RemoteCliUsage> }

/**
 * The last good result per host and CLI. It outlives a disconnect and an app restart, so a host
 * that cannot be reached keeps showing what it last reported, labelled with when that was.
 */
export class RemoteUsageCache {
  private readonly hosts = new Map<string, HostEntry>()
  private readonly writer: UsageCacheSnapshotWriter

  constructor(private readonly resolveFile: () => string) {
    this.writer = new UsageCacheSnapshotWriter('[usage-hosts]', resolveFile)
    this.load()
  }

  get(hostId: string, cli: string): RemoteCliUsage | undefined {
    return this.hosts.get(hostId)?.clis.get(cli)
  }

  listHostIds(): string[] {
    return [...this.hosts.keys()]
  }

  async set(hostId: string, label: string, cli: string, entry: RemoteCliUsage): Promise<void> {
    const host = this.hosts.get(hostId) ?? { label, clis: new Map() }
    host.label = label
    host.clis.set(cli, entry)
    this.hosts.set(hostId, host)
    await this.persist()
  }

  /** Records a successful no-change check without replacing the files. */
  async touch(hostId: string, cli: string, lastSuccessAt: number): Promise<void> {
    const entry = this.get(hostId, cli)
    if (entry) {
      this.hosts.get(hostId)?.clis.set(cli, { ...entry, lastSuccessAt })
      await this.persist()
    }
  }

  async forget(hostId: string): Promise<void> {
    if (this.hosts.delete(hostId)) {
      await this.persist()
    }
  }

  flush(): Promise<void> {
    return this.writer.flush()
  }

  private persist(): Promise<void> {
    return this.writer.write(() =>
      JSON.stringify({
        version: 1,
        hosts: Object.fromEntries(
          [...this.hosts].map(([hostId, host]) => [
            hostId,
            { label: host.label, clis: Object.fromEntries(host.clis) }
          ])
        )
      })
    )
  }

  private load(): void {
    try {
      const file = this.resolveFile()
      if (!existsSync(file)) {
        return
      }
      const parsed = persistedSchema.safeParse(JSON.parse(readFileSync(file, 'utf-8')))
      if (!parsed.success) {
        return
      }
      for (const [hostId, host] of Object.entries(parsed.data.hosts)) {
        this.hosts.set(hostId, { label: host.label, clis: new Map(Object.entries(host.clis)) })
      }
    } catch (error) {
      console.error('[usage-hosts] Failed to load the remote usage cache, starting empty:', error)
    }
  }
}
