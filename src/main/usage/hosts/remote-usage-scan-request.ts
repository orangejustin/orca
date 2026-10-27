import {
  USAGE_SCAN_RELAY_METHOD,
  USAGE_SCAN_RELAY_TIMEOUT_MS,
  usageScanRelayResultSchema,
  type UsageScanRelayFile,
  type UsageScanRelayPage,
  type UsageScanRelayWorktree
} from '../../../shared/usage-scan-relay'

const MAX_REMOTE_FILES_PER_SYNC = 100_000
const MAX_MESSAGE_LENGTH = 240

/** The slice of the SSH multiplexer a sync needs. */
export type UsageHostMux = {
  request(
    method: string,
    params: Record<string, unknown>,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<unknown>
  isDisposed(): boolean
}

export type UsageScanBaseParams = {
  cli: string
  timeZone: string
  worktrees: UsageScanRelayWorktree[]
}

/** The host replaced its result while it was being read in pages. */
export class StaleScanResultError extends Error {}

function boundedMessage(message: string): string {
  return message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…` : message
}

export function describeFailure(error: unknown): string {
  return boundedMessage(error instanceof Error ? error.message : String(error))
}

export async function requestUsageScanPage(
  mux: UsageHostMux,
  params: Record<string, unknown>,
  signal?: AbortSignal
) {
  const reply = await mux.request(USAGE_SCAN_RELAY_METHOD, params, {
    timeoutMs: USAGE_SCAN_RELAY_TIMEOUT_MS,
    signal
  })
  const parsed = usageScanRelayResultSchema.safeParse(reply)
  if (!parsed.success) {
    throw new Error('The host returned a usage reply Orca could not read.')
  }
  return parsed.data
}

export async function readRemainingUsagePages(
  mux: UsageHostMux,
  base: UsageScanBaseParams,
  first: UsageScanRelayPage,
  signal?: AbortSignal
): Promise<UsageScanRelayFile[]> {
  const files = [...first.files]
  let next = first.nextOffset
  while (next !== null) {
    if (files.length > MAX_REMOTE_FILES_PER_SYNC) {
      throw new Error('The host reported more usage files than Orca will read.')
    }
    let page
    try {
      page = await requestUsageScanPage(
        mux,
        { ...base, page: { revision: first.revision, offset: next } },
        signal
      )
    } catch (error) {
      // The relay refuses a page of a result it has since replaced.
      if (error instanceof Error && /changed/.test(error.message)) {
        throw new StaleScanResultError(error.message)
      }
      throw error
    }
    if (page.kind !== 'page' || page.revision !== first.revision) {
      throw new StaleScanResultError('The host’s usage result changed while it was being read.')
    }
    files.push(...page.files)
    next = page.nextOffset
  }
  return files
}
