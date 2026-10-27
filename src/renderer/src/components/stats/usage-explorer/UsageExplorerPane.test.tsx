// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageServiceApi } from '../../../../../preload/api/agent-usage-api'
import {
  DEFAULT_USAGE_QUERY_FILTERS,
  type UsageQueryBreakdownRow,
  type UsageQueryTotals
} from '../../../../../shared/usage-query-types'
import type { UsageAdapterInfo, UsageViewSnapshot } from '../../../../../shared/usage-service-types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UsageExplorerPane } from './UsageExplorerPane'
import { UsageMultiFilter } from './UsageMultiFilter'
import { useUsageExplorer } from './usage-explorer-store'

afterEach(cleanup)

function totals(overrides: Partial<UsageQueryTotals> = {}): UsageQueryTotals {
  return {
    events: 10,
    sessions: 3,
    freshInputTokens: 1_000,
    cacheReadTokens: 500,
    cacheWriteTokens: 0,
    outputTokens: 500,
    reasoningTokens: 0,
    totalTokens: 2_000,
    reportedCostUsd: null,
    estimatedCostUsd: 1.5,
    pricedTokens: 1_500,
    unpricedTokens: 500,
    ...overrides
  }
}

function row(
  key: string,
  label: string,
  overrides: Partial<UsageQueryTotals> = {}
): UsageQueryBreakdownRow {
  return { key, label, ...totals(overrides) }
}

function adapter(
  id: string,
  label: string,
  overrides: Partial<UsageAdapterInfo> = {}
): UsageAdapterInfo {
  return {
    id,
    label,
    cost: { basis: 'estimated', source: 'Public API prices, bundled with Orca', url: null },
    logFormatVerified: true,
    remoteScan: true,
    collecting: true,
    isScanning: false,
    hasData: true,
    lastScanCompletedAt: Date.now() - 60_000,
    lastScanError: null,
    excluded: false,
    hidden: false,
    ...overrides
  }
}

function snapshot(overrides: Partial<UsageViewSnapshot> = {}): UsageViewSnapshot {
  return {
    result: {
      filters: DEFAULT_USAGE_QUERY_FILTERS,
      totals: totals(),
      daily: [
        { day: '2026-06-09', ...omitSessions(totals({ totalTokens: 800 })) },
        { day: '2026-06-10', ...omitSessions(totals({ totalTokens: 1_200 })) }
      ],
      byCli: [
        row('claude', 'Claude Code', { pricedTokens: 1_500, unpricedTokens: 0 }),
        row('trae', 'Trae CLI', {
          estimatedCostUsd: null,
          pricedTokens: 0,
          unpricedTokens: 500,
          totalTokens: 500
        })
      ],
      byHost: [row('local', 'This computer'), row('ssh:cloud', 'cloud box')],
      byProvider: [row('anthropic', 'Anthropic')],
      byModel: [row('claude-opus-4-5', 'claude-opus-4-5')],
      byProject: [row('worktree:w1', 'app')],
      options: {
        clis: [
          { key: 'claude', label: 'Claude Code' },
          { key: 'trae', label: 'Trae CLI' }
        ],
        hosts: [
          { key: 'local', label: 'This computer' },
          { key: 'ssh:cloud', label: 'cloud box' }
        ],
        providers: [{ key: 'anthropic', label: 'Anthropic' }],
        models: [{ key: 'claude-opus-4-5', label: 'claude-opus-4-5' }],
        projects: [{ key: 'worktree:w1', label: 'app' }]
      },
      activeDays: 2
    },
    population: 'orca-worktrees',
    adapters: [
      adapter('claude', 'Claude Code'),
      adapter('trae', 'Trae CLI', {
        logFormatVerified: false,
        cost: { basis: 'none', source: null, url: null }
      })
    ],
    unsupportedClis: [
      { id: 'aider', label: 'Aider' },
      { id: 'gemini', label: 'Gemini' }
    ],
    hosts: [],
    dedupe: { duplicateFiles: 0, overlappingSessions: 0 },
    pricing: [
      {
        cli: 'claude',
        label: 'Claude Code',
        basis: 'estimated',
        source: 'Anthropic public API prices, bundled with Orca',
        url: null,
        tableVersion: '1.4.214',
        pricedTokenShare: 1
      },
      {
        cli: 'trae',
        label: 'Trae CLI',
        basis: 'none',
        source: null,
        url: null,
        tableVersion: '1.4.214',
        pricedTokenShare: 0
      }
    ],
    preferences: { excludedClis: [], hiddenClis: [] },
    timeZone: 'Asia/Tokyo',
    ...overrides
  }
}

function omitSessions(value: UsageQueryTotals): Omit<UsageQueryTotals, 'sessions'> {
  const { sessions: _sessions, ...rest } = value
  return rest
}

function installApi(view: UsageViewSnapshot) {
  const api: UsageServiceApi = {
    query: vi.fn(async () => view),
    refresh: vi.fn(async () => undefined),
    syncHosts: vi.fn(async () => []),
    setCollecting: vi.fn(async () => undefined),
    setPreferences: vi.fn(async (preferences) => preferences)
  }
  Object.defineProperty(window, 'api', { value: { usage: api }, configurable: true })
  return api
}

function renderPane() {
  return render(
    <TooltipProvider>
      <UsageExplorerPane />
    </TooltipProvider>
  )
}

beforeEach(() => {
  useUsageExplorer.setState(useUsageExplorer.getInitialState(), true)
})

describe('UsageExplorerPane', () => {
  it('states which sessions and which time zone the numbers describe', async () => {
    installApi(snapshot())
    renderPane()
    const population = await screen.findByTestId('usage-population')
    expect(population).toHaveTextContent('Sessions in Orca worktrees only')
    expect(population).toHaveTextContent('Asia/Tokyo')
  })

  it('names the other population when the scope changes', async () => {
    installApi(snapshot({ population: 'all-readable-history' }))
    renderPane()
    expect(await screen.findByTestId('usage-population')).toHaveTextContent(
      'All readable CLI history'
    )
  })

  it('keeps reported cost, estimated cost and unpriced tokens as separate figures', async () => {
    installApi(
      snapshot({
        result: {
          ...snapshot().result,
          totals: totals({ reportedCostUsd: 0.42, estimatedCostUsd: 1.5, unpricedTokens: 500 })
        }
      })
    )
    renderPane()
    expect(await screen.findByTestId('usage-cost-estimated')).toHaveTextContent('$1.50')
    expect(screen.getByTestId('usage-cost-reported')).toHaveTextContent('$0.42')
    expect(screen.getByTestId('usage-cost-unpriced')).toHaveTextContent('500')
    expect(screen.getByText(/not what you are billed/i)).toBeInTheDocument()
  })

  it('does not show a dollar figure as if it were zero when nothing is priced', async () => {
    installApi(
      snapshot({
        result: {
          ...snapshot().result,
          totals: totals({ estimatedCostUsd: null, pricedTokens: 0, unpricedTokens: 2_000 })
        }
      })
    )
    renderPane()
    expect(await screen.findByTestId('usage-cost-estimated')).toHaveTextContent('n/a')
    expect(screen.getByText(/That is not zero cost/i)).toBeInTheDocument()
  })

  it('shows where each CLI’s price comes from, with the table version and coverage', async () => {
    installApi(snapshot())
    renderPane()
    const sources = await screen.findByTestId('usage-cost-sources')
    expect(within(sources).getByText(/Anthropic public API prices/)).toBeInTheDocument()
    expect(sources).toHaveTextContent('price table in Orca 1.4.214')
    expect(sources).toHaveTextContent('100% priced')
    expect(sources).toHaveTextContent('0% priced')
  })

  it('marks a host that dropped as stale with its last sync, and explains the gaps', async () => {
    installApi(
      snapshot({
        hosts: [
          {
            hostId: 'ssh:cloud',
            label: 'cloud box',
            clis: [
              {
                cli: 'claude',
                status: 'stale',
                lastSuccessAt: Date.now() - 3_600_000,
                message: 'The host is not connected.'
              },
              {
                cli: 'trae',
                status: 'unsupported',
                lastSuccessAt: null,
                message: 'This host’s relay does not scan this CLI.'
              },
              {
                cli: 'opencode',
                status: 'unsupported',
                lastSuccessAt: null,
                message: 'Not scanned on remote hosts yet.'
              }
            ]
          }
        ],
        dedupe: { duplicateFiles: 2, overlappingSessions: 1 }
      })
    )
    renderPane()
    const rows = await screen.findAllByTestId('usage-host-coverage-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('cloud box')
    expect(rows[0]).toHaveTextContent('Stale')
    expect(rows[0]).toHaveTextContent('Last synced')
    expect(rows[0]).toHaveTextContent('The host is not connected.')
    expect(rows[0]).toHaveTextContent('Not scanned on remote hosts yet.')
    expect(
      screen.getByText(/2 log file\(s\) found on more than one host were counted once/)
    ).toBeInTheDocument()
    expect(screen.getByText(/1 session\(s\) exist on several hosts/)).toBeInTheDocument()
  })

  it('says it is counting this computer only when no host is registered', async () => {
    installApi(snapshot())
    renderPane()
    expect(await screen.findByText(/This computer only/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sync hosts/i })).toBeDisabled()
  })

  it('syncs hosts only when asked', async () => {
    const api = installApi(
      snapshot({ hosts: [{ hostId: 'ssh:cloud', label: 'cloud box', clis: [] }] })
    )
    renderPane()
    const button = await screen.findByRole('button', { name: /sync hosts/i })
    expect(api.syncHosts).not.toHaveBeenCalled()
    await userEvent.click(button)
    expect(api.syncHosts).toHaveBeenCalledTimes(1)
  })

  it('shows an unpriced row as "No price" rather than a cost of zero', async () => {
    installApi(snapshot())
    renderPane()
    const table = await screen.findByTestId('usage-breakdown-table')
    const trae = within(table).getByText('Trae CLI').closest('tr')
    expect(trae).not.toBeNull()
    expect(trae).toHaveTextContent('No price')
    expect(trae).not.toHaveTextContent('$0')
  })

  it('switches the breakdown to hosts', async () => {
    installApi(snapshot())
    renderPane()
    await userEvent.click(await screen.findByRole('tab', { name: 'Host' }))
    const table = screen.getByTestId('usage-breakdown-table')
    expect(within(table).getByText('cloud box')).toBeInTheDocument()
  })

  it('flags the CLI whose log format has not been checked and lists CLIs without an adapter', async () => {
    installApi(snapshot())
    renderPane()
    await userEvent.click(await screen.findByRole('button', { name: /CLIs/ }))
    expect(screen.getByTestId('usage-adapter-trae')).toHaveTextContent(
      'not checked against a real capture'
    )
    expect(screen.getByTestId('usage-adapter-claude')).not.toHaveTextContent('not checked')
    expect(screen.getByTestId('usage-unsupported-clis')).toHaveTextContent('Aider, Gemini')
    expect(screen.getByTestId('usage-unsupported-clis')).toHaveTextContent(
      'does not estimate them from terminal output'
    )
  })

  it('keeps stopping collection, leaving out of totals and hiding as three separate actions', async () => {
    const api = installApi(snapshot())
    renderPane()
    await userEvent.click(await screen.findByRole('button', { name: /CLIs/ }))
    const trae = screen.getByTestId('usage-adapter-trae')

    await userEvent.click(within(trae).getByRole('switch', { name: 'Collect' }))
    expect(api.setCollecting).toHaveBeenLastCalledWith({ cli: 'trae', enabled: false })
    expect(api.setPreferences).not.toHaveBeenCalled()

    await userEvent.click(within(trae).getByRole('switch', { name: 'Count in totals' }))
    expect(api.setPreferences).toHaveBeenLastCalledWith({ excludedClis: ['trae'], hiddenClis: [] })

    await userEvent.click(within(trae).getByRole('button', { name: 'Hide' }))
    expect(api.setPreferences).toHaveBeenLastCalledWith({ excludedClis: [], hiddenClis: ['trae'] })
  })

  it('lists hidden CLIs apart and lets them be shown again', async () => {
    const api = installApi(
      snapshot({
        adapters: [adapter('claude', 'Claude Code'), adapter('trae', 'Trae CLI', { hidden: true })],
        preferences: { excludedClis: [], hiddenClis: ['trae'] }
      })
    )
    renderPane()
    await userEvent.click(await screen.findByRole('button', { name: /CLIs/ }))
    expect(screen.getByText('Hidden')).toBeInTheDocument()
    await userEvent.click(
      within(screen.getByTestId('usage-adapter-trae')).getByRole('button', { name: 'Show' })
    )
    expect(api.setPreferences).toHaveBeenLastCalledWith({ excludedClis: [], hiddenClis: [] })
  })

  it('offers to collect an idle CLI when there is nothing to show', async () => {
    const api = installApi(
      snapshot({
        result: {
          ...snapshot().result,
          totals: totals({ totalTokens: 0, events: 0, sessions: 0 }),
          daily: []
        },
        adapters: [adapter('claude', 'Claude Code', { collecting: false, hasData: false })]
      })
    )
    renderPane()
    await userEvent.click(await screen.findByRole('button', { name: 'Collect Claude Code' }))
    expect(api.setCollecting).toHaveBeenCalledWith({ cli: 'claude', enabled: true })
  })

  it('says the desktop app is needed when the usage API is absent', async () => {
    Object.defineProperty(window, 'api', { value: {}, configurable: true })
    renderPane()
    expect(await screen.findByText(/only available in the desktop app/i)).toBeInTheDocument()
  })
})

describe('UsageMultiFilter', () => {
  const options = [
    { key: 'a', label: 'Alpha' },
    { key: 'b', label: 'Beta' },
    { key: 'c', label: 'Gamma' }
  ]

  it('narrows, widens and clears the selection', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <UsageMultiFilter label="Model" options={options} selected={null} onChange={onChange} />
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByText('Beta'))
    expect(onChange).toHaveBeenLastCalledWith(['b'])

    rerender(
      <UsageMultiFilter label="Model" options={options} selected={['b']} onChange={onChange} />
    )
    await userEvent.click(within(screen.getByRole('dialog')).getByText('Gamma'))
    expect(onChange).toHaveBeenLastCalledWith(['b', 'c'])

    await userEvent.click(within(screen.getByRole('dialog')).getByText('Beta'))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('treats choosing every option as no restriction, and filters by search', async () => {
    const onChange = vi.fn()
    render(
      <UsageMultiFilter label="Model" options={options} selected={['a', 'b']} onChange={onChange} />
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByText('Gamma'))
    expect(onChange).toHaveBeenLastCalledWith(null)

    await userEvent.type(screen.getByPlaceholderText('Search…'), 'alp')
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })
})
