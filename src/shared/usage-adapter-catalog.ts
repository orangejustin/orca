import type { UsageCostBasis } from './usage-query-types'

/**
 * Every CLI Orca can read usage from. A CLI absent from this list has no adapter and shows as
 * unsupported: Orca never estimates tokens from terminal text.
 *
 * Ids match the `TuiAgent` ids of the CLIs Orca launches.
 */
export type UsageAdapterCatalogEntry = {
  id: string
  label: string
  /** Where the dollar figure for this CLI comes from, if anywhere. */
  cost: {
    basis: Exclude<UsageCostBasis, 'unknown'> | 'none'
    /** Human-readable origin of the price, shown beside the total. */
    source: string | null
    url: string | null
  }
  /** False until the log format has been checked against a real capture of the CLI. */
  logFormatVerified: boolean
  /** Whether a remote host can be scanned for this CLI through the relay. */
  remoteScan: boolean
}

export const USAGE_ADAPTER_CATALOG: readonly UsageAdapterCatalogEntry[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    cost: {
      basis: 'estimated',
      source: 'Anthropic public API prices, bundled with Orca',
      url: 'https://platform.claude.com/docs/en/about-claude/pricing'
    },
    logFormatVerified: true,
    remoteScan: true
  },
  {
    id: 'codex',
    label: 'Codex',
    cost: { basis: 'estimated', source: 'OpenAI public API prices, bundled with Orca', url: null },
    logFormatVerified: true,
    remoteScan: true
  },
  {
    id: 'trae',
    label: 'Trae CLI',
    cost: { basis: 'none', source: null, url: null },
    // Built from the record names alone; no real Trae CLI log has been read yet.
    logFormatVerified: false,
    remoteScan: true
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    cost: { basis: 'reported', source: 'Cost OpenCode wrote to its own database', url: null },
    logFormatVerified: true,
    remoteScan: false
  },
  {
    id: 'muse',
    label: 'Muse Code',
    cost: { basis: 'none', source: null, url: null },
    logFormatVerified: true,
    remoteScan: false
  }
]

export function getUsageAdapterCatalogEntry(id: string): UsageAdapterCatalogEntry | undefined {
  return USAGE_ADAPTER_CATALOG.find((entry) => entry.id === id)
}
