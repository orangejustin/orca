import { z } from 'zod'

/**
 * Remote usage scan over the SSH relay. The host reads its own CLI logs and returns per-file
 * aggregates only: no transcripts, no message text, no credentials, and no file paths.
 */
export const USAGE_SCAN_RELAY_METHOD = 'usage.scan' as const
export const USAGE_SCAN_RELAY_TIMEOUT_MS = 180_000
export const USAGE_SCAN_RELAY_PAGE_BYTES = 600_000
export const USAGE_SCAN_RELAY_MAX_WORKTREES = 5_000

/** CLIs a host can scan remotely. A relay built before a CLI joined this list answers unsupported. */
export const USAGE_SCAN_RELAY_CLIS = ['claude', 'codex', 'trae'] as const
export type UsageScanRelayCli = (typeof USAGE_SCAN_RELAY_CLIS)[number]

export function isUsageScanRelayCli(value: string): value is UsageScanRelayCli {
  return USAGE_SCAN_RELAY_CLIS.some((cli) => cli === value)
}

export type UsageScanRelayWorktree = {
  repoId: string
  worktreeId: string
  path: string
  displayName: string
}

export type UsageScanRelayParams = {
  cli: string
  /** The host's own worktrees, so Orca-managed work is recognised on the machine that ran it. */
  worktrees: UsageScanRelayWorktree[]
  /**
   * IANA zone the days are bucketed in. Every host uses the viewer's zone, otherwise a UTC cloud
   * machine would put an evening's work on the next day and the windows would not line up.
   */
  timeZone: string
  /** Revision of the result the caller already holds; an unchanged host answers not-modified. */
  knownRevision?: string | null
  /** Continue a result the host is holding. Absent starts (or reuses) a scan. */
  page?: { revision: string; offset: number }
}

export const usageScanRelayFileSchema = z.object({
  /** Hash of the events the file owns; equal on any host holding a copy. Null when it owns none. */
  digest: z.string().min(1).nullable(),
  sessions: z.array(z.unknown()),
  dailyAggregates: z.array(z.unknown())
})

export type UsageScanRelayFile = z.infer<typeof usageScanRelayFileSchema>

/** What one scan produces, before the relay cuts it into pages. */
export const usageScanOutputSchema = z.object({
  revision: z.string(),
  scannedAt: z.number(),
  files: z.array(usageScanRelayFileSchema)
})

export type UsageScanOutput = z.infer<typeof usageScanOutputSchema>

export const usageScanRelayResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not-modified'), revision: z.string() }),
  z.object({ kind: z.literal('unsupported-cli'), cli: z.string() }),
  z.object({
    kind: z.literal('page'),
    cli: z.string(),
    revision: z.string(),
    timeZone: z.string(),
    scannedAt: z.number(),
    offset: z.number().int().nonnegative(),
    /** Null on the last page. */
    nextOffset: z.number().int().nonnegative().nullable(),
    totalFiles: z.number().int().nonnegative(),
    files: z.array(usageScanRelayFileSchema)
  })
])

export type UsageScanRelayResult = z.infer<typeof usageScanRelayResultSchema>
export type UsageScanRelayPage = Extract<UsageScanRelayResult, { kind: 'page' }>
