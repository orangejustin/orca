import { LOCAL_USAGE_HOST_ID } from '../query/unified-usage-row'
import type { UsageRow, UsageSessionRef } from '../query/unified-usage-row'

/** One source file of one CLI on one host, already mapped into unified rows. */
export type HostUsageFile = {
  hostId: string
  cli: string
  /** Content digest of the events the file owns; null when it owns none. */
  digest: string | null
  rows: UsageRow[]
  sessions: UsageSessionRef[]
}

export type HostMergeResult = {
  rows: UsageRow[]
  sessions: UsageSessionRef[]
  /** Files whose contents were already counted from a higher-priority host. */
  duplicateFiles: number
  /** Sessions on several hosts whose files differ, so both copies are counted. */
  overlappingSessions: number
}

function hostRank(hostId: string, order: readonly string[]): number {
  if (hostId === LOCAL_USAGE_HOST_ID) {
    return -1
  }
  const index = order.indexOf(hostId)
  return index === -1 ? order.length : index
}

function mergeSessionRefs(refs: readonly UsageSessionRef[]): UsageSessionRef[] {
  const byKey = new Map<string, UsageSessionRef>()
  for (const ref of refs) {
    const key = `${ref.cli}\u0000${ref.hostId}\u0000${ref.sessionId}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        ...ref,
        worktreeIds: [...ref.worktreeIds],
        modelKeys: [...ref.modelKeys],
        projectKeys: [...ref.projectKeys],
        providers: [...ref.providers]
      })
      continue
    }
    existing.lastDay = existing.lastDay > ref.lastDay ? existing.lastDay : ref.lastDay
    existing.worktreeIds.push(...ref.worktreeIds)
    existing.modelKeys = [...new Set([...existing.modelKeys, ...ref.modelKeys])]
    existing.projectKeys = [...new Set([...existing.projectKeys, ...ref.projectKeys])]
    existing.providers = [...new Set([...existing.providers, ...ref.providers])]
  }
  return [...byKey.values()]
}

/**
 * Combines every host's files, counting a log that was copied between machines once.
 *
 * Putting the host in the key would not do that: the copy has a different host and the same
 * contents, and would be summed. Identity here is the digest of the events a file owns, so the
 * copy is recognised by what it contains. The local host wins, then hosts in `hostOrder`, so the
 * result does not depend on which host answered first.
 *
 * A session found on two hosts with different contents (copied, then continued on both) cannot be
 * split at row level, so it is counted on each and reported in `overlappingSessions`.
 */
export function mergeHostUsageFiles(
  files: readonly HostUsageFile[],
  hostOrder: readonly string[]
): HostMergeResult {
  const ranked = [...files].sort(
    (left, right) => hostRank(left.hostId, hostOrder) - hostRank(right.hostId, hostOrder)
  )
  const seenDigests = new Set<string>()
  const rows: UsageRow[] = []
  const sessionRefs: UsageSessionRef[] = []
  let duplicateFiles = 0
  for (const file of ranked) {
    if (file.digest !== null) {
      const identity = `${file.cli}\u0000${file.digest}`
      if (seenDigests.has(identity)) {
        duplicateFiles++
        continue
      }
      seenDigests.add(identity)
    }
    rows.push(...file.rows)
    sessionRefs.push(...file.sessions)
  }

  const sessions = mergeSessionRefs(sessionRefs)
  const hostsBySession = new Map<string, Set<string>>()
  for (const session of sessions) {
    const key = `${session.cli}\u0000${session.sessionId}`
    const hosts = hostsBySession.get(key) ?? new Set<string>()
    hosts.add(session.hostId)
    hostsBySession.set(key, hosts)
  }
  const overlappingSessions = [...hostsBySession.values()].filter((hosts) => hosts.size > 1).length
  return { rows, sessions, duplicateFiles, overlappingSessions }
}
