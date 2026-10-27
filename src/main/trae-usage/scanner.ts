import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { readJsonlLinesFromOffset } from '../usage/jsonl-line-offsets'
import { attributeUsageEvent } from '../usage/usage-event-attribution'
import { createUsageEventAggregation } from '../usage/usage-event-aggregation'
import type { UsageScanWorktreeRef } from '../usage/usage-provider-contract'
import {
  createUsageWorktreeResolver,
  type UsageWorktreeResolver
} from '../usage/usage-worktree-resolver'
import { listTraeUsageLogFiles } from './trae-usage-log-discovery'
import {
  dropMirroredTokenCounts,
  lineMayCarryTraeUsage,
  parseTraeUsageLine,
  type TraeUsageParseContext
} from './trae-usage-record-parser'
import type {
  TraeUsageAttributedEvent,
  TraeUsageDailyAggregate,
  TraeUsageMetric,
  TraeUsageParsedEvent,
  TraeUsagePersistedFile,
  TraeUsageProcessedFile,
  TraeUsageSession
} from './types'

const YIELD_EVERY_FILES = 10

export const traeUsageAggregation = createUsageEventAggregation<
  TraeUsageAttributedEvent,
  TraeUsageMetric
>({
  metric: { empty: () => ({}), fromEvent: () => ({}), fold: () => {} },
  cloneSessionForMerge: (session) => ({
    ...session,
    locationBreakdown: session.locationBreakdown.map((entry) => ({ ...entry })),
    modelBreakdown: session.modelBreakdown.map((entry) => ({ ...entry })),
    locationModelBreakdown: session.locationModelBreakdown.map((entry) => ({ ...entry }))
  })
})

type TraeLogInfo = TraeUsageProcessedFile

async function yieldToEventLoop(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

async function statLog(path: string): Promise<TraeLogInfo | null> {
  try {
    const fileStat = await stat(path)
    return fileStat.isFile() ? { path, mtimeMs: fileStat.mtimeMs, size: fileStat.size } : null
  } catch {
    // Vanished between listing and stat; the next scan sees the new state.
    return null
  }
}

async function readTraeEvents(path: string): Promise<TraeUsageParsedEvent[]> {
  const context: TraeUsageParseContext = {
    // Why: only the file's stem leaves this host as a session id, never its directory.
    sessionId: basename(path, '.jsonl'),
    cwd: null,
    currentModel: null,
    previousTotals: null
  }
  const events: TraeUsageParsedEvent[] = []
  // Always from byte 0: truncation, replacement and a half-written last line all change size or
  // mtime, so a changed file is reparsed whole and a partial tail line is retried next scan.
  for await (const { line } of readJsonlLinesFromOffset(path, 0)) {
    if (!lineMayCarryTraeUsage(line)) {
      continue
    }
    const event = parseTraeUsageLine(line, context)
    if (event) {
      events.push(event)
    }
  }
  return dropMirroredTokenCounts(events)
}

type TraeFileParseInput = {
  info: TraeLogInfo
  resolveWorktree: UsageWorktreeResolver
  claimEventKey: (eventKey: string) => boolean
}

export async function parseTraeUsageFile(
  input: TraeFileParseInput
): Promise<TraeUsagePersistedFile> {
  const events: TraeUsageAttributedEvent[] = []
  const ownedEventKeys = new Set<string>()
  const occurrencesByContentKey = new Map<string, number>()
  let hasDeferredClaims = false
  for (const parsed of await readTraeEvents(input.info.path)) {
    // Why: records without a request id can repeat their content inside one log; the ordinal keeps
    // them apart while a copied log still maps onto the same sequence of keys.
    let eventKey = parsed.eventKey
    if (!eventKey.startsWith('req:')) {
      const occurrence = occurrencesByContentKey.get(eventKey) ?? 0
      occurrencesByContentKey.set(eventKey, occurrence + 1)
      eventKey = `${eventKey}#${occurrence}`
    }
    if (!input.claimEventKey(eventKey)) {
      hasDeferredClaims = true
      continue
    }
    ownedEventKeys.add(eventKey)
    const attributed = attributeUsageEvent(parsed, input.resolveWorktree)
    if (attributed) {
      events.push(attributed)
    }
  }
  return {
    path: input.info.path,
    mtimeMs: input.info.mtimeMs,
    size: input.info.size,
    ...traeUsageAggregation.aggregate(events),
    ownedEventKeys: [...ownedEventKeys],
    hasDeferredClaims
  }
}

export async function scanTraeUsageFiles(
  worktrees: UsageScanWorktreeRef[],
  previousProcessedFiles: TraeUsagePersistedFile[],
  onFilesScanned?: (count: number) => void,
  roots?: string[]
): Promise<{
  processedFiles: TraeUsagePersistedFile[]
  sessions: TraeUsageSession[]
  dailyAggregates: TraeUsageDailyAggregate[]
}> {
  const paths = await listTraeUsageLogFiles(roots)
  const previousByPath = new Map(previousProcessedFiles.map((file) => [file.path, file]))
  const resolveWorktree = await createUsageWorktreeResolver(worktrees)

  const logs: TraeLogInfo[] = []
  for (const [index, path] of paths.entries()) {
    const info = await statLog(path)
    if (info) {
      logs.push(info)
    }
    if ((index + 1) % YIELD_EVERY_FILES === 0) {
      await yieldToEventLoop()
    }
  }

  const currentPaths = new Set(logs.map((log) => log.path))
  // Why: a deleted owner leaves its events unowned; only files that deferred to it must reclaim.
  const lostOwnerPath = previousProcessedFiles.some(
    (file) => !currentPaths.has(file.path) && file.ownedEventKeys.length > 0
  )
  const eventOwnerByKey = new Map<string, string>()
  const claimFor =
    (path: string) =>
    (eventKey: string): boolean => {
      const owner = eventOwnerByKey.get(eventKey)
      if (owner !== undefined && owner !== path) {
        return false
      }
      eventOwnerByKey.set(eventKey, path)
      return true
    }

  const isStatUnchanged = (log: TraeLogInfo): boolean => {
    const previous = previousByPath.get(log.path)
    const mustReclaimDeferred = lostOwnerPath && previous?.hasDeferredClaims !== false
    return (
      previous !== undefined &&
      !mustReclaimDeferred &&
      previous.mtimeMs === log.mtimeMs &&
      previous.size === log.size
    )
  }
  // Retained claims register before any parse so a reparsed file cannot steal them.
  for (const log of logs) {
    if (isStatUnchanged(log)) {
      for (const eventKey of previousByPath.get(log.path)?.ownedEventKeys ?? []) {
        if (!eventOwnerByKey.has(eventKey)) {
          eventOwnerByKey.set(eventKey, log.path)
        }
      }
    }
  }

  const processedFiles: TraeUsagePersistedFile[] = []
  const sessionsById = new Map<string, TraeUsageSession>()
  const dailyByKey = new Map<string, TraeUsageDailyAggregate>()
  let parsedCount = 0
  for (const log of logs) {
    const previous = previousByPath.get(log.path)
    let processed: TraeUsagePersistedFile | null = null
    if (previous && isStatUnchanged(log)) {
      processed = previous
    } else {
      try {
        processed = await parseTraeUsageFile({
          info: log,
          resolveWorktree,
          claimEventKey: claimFor(log.path)
        })
      } catch {
        // Unreadable or vanished mid-scan; the next scan retries it.
      }
      onFilesScanned?.(1)
      parsedCount++
      if (parsedCount % YIELD_EVERY_FILES === 0) {
        await yieldToEventLoop()
      }
    }
    if (!processed) {
      continue
    }
    processedFiles.push(processed)
    traeUsageAggregation.mergeSessions(sessionsById, processed.sessions)
    traeUsageAggregation.mergeDailyAggregates(dailyByKey, processed.dailyAggregates)
  }

  return {
    processedFiles,
    sessions: traeUsageAggregation.finalizeSessions(sessionsById),
    dailyAggregates: traeUsageAggregation.sortDailyAggregates(dailyByKey)
  }
}
