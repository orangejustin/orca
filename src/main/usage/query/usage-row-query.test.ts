import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_USAGE_QUERY_FILTERS,
  type UsageQueryFilters,
  type UsageQueryResult
} from '../../../shared/usage-query-types'
import { queryUsage, type UsageQueryLabels } from './usage-row-query'
import type { UsageRow, UsageSessionRef } from './unified-usage-row'

const LABELS: UsageQueryLabels = {
  clis: { claude: 'Claude', codex: 'Codex', trae: 'Trae' },
  hosts: { local: 'This computer', 'ssh:cloud': 'cloud' }
}

function row(overrides: Partial<UsageRow>): UsageRow {
  const base: UsageRow = {
    cli: 'claude',
    hostId: 'local',
    day: '2026-06-10',
    model: 'claude-opus-4-5',
    provider: 'anthropic',
    projectKey: 'worktree:w1',
    projectLabel: 'app',
    worktreeId: 'w1',
    events: 1,
    freshInputTokens: 100,
    cacheReadTokens: 50,
    cacheWriteTokens: 10,
    outputTokens: 40,
    reasoningTokens: 0,
    totalTokens: 200,
    costUsd: 1,
    costBasis: 'estimated',
    pricedTokens: 200,
    unpricedTokens: 0
  }
  return { ...base, ...overrides }
}

const ROWS: UsageRow[] = [
  row({}),
  row({ day: '2026-06-11', events: 2 }),
  row({
    cli: 'codex',
    model: 'gpt-5.4',
    provider: 'openai',
    projectKey: 'worktree:w2',
    projectLabel: 'api',
    worktreeId: 'w2',
    costUsd: 2,
    costBasis: 'reported'
  }),
  row({
    cli: 'trae',
    hostId: 'ssh:cloud',
    model: 'doubao-seed-1.6',
    provider: 'bytedance',
    projectKey: 'ssh:cloud|cwd:/srv/app',
    projectLabel: 'srv/app',
    worktreeId: null,
    costUsd: null,
    costBasis: 'unknown',
    pricedTokens: 0,
    unpricedTokens: 200
  }),
  row({
    cli: 'claude',
    hostId: 'ssh:cloud',
    model: null,
    provider: 'unknown',
    projectKey: 'ssh:cloud|cwd:/srv/app',
    projectLabel: 'srv/app',
    worktreeId: null,
    costUsd: null,
    costBasis: 'unknown',
    pricedTokens: 0,
    unpricedTokens: 200
  })
]

const SESSIONS: UsageSessionRef[] = [
  {
    cli: 'claude',
    hostId: 'local',
    sessionId: 'a',
    lastDay: '2026-06-11',
    worktreeIds: ['w1'],
    modelKeys: ['claude-opus-4-5'],
    projectKeys: ['worktree:w1'],
    providers: ['anthropic']
  },
  {
    cli: 'trae',
    hostId: 'ssh:cloud',
    sessionId: 'b',
    lastDay: '2026-06-10',
    worktreeIds: [null],
    modelKeys: ['doubao-seed-1.6'],
    projectKeys: ['ssh:cloud|cwd:/srv/app'],
    providers: ['bytedance']
  }
]

function query(overrides: Partial<UsageQueryFilters> = {}): UsageQueryResult {
  return queryUsage({
    rows: ROWS,
    sessions: SESSIONS,
    labels: LABELS,
    filters: { ...DEFAULT_USAGE_QUERY_FILTERS, scope: 'all', range: 'all', ...overrides }
  })
}

const ADDITIVE_FIELDS = [
  'events',
  'freshInputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'outputTokens',
  'reasoningTokens',
  'totalTokens',
  'pricedTokens',
  'unpricedTokens'
] as const

function expectDimensionsToSumToTotals(result: UsageQueryResult): void {
  const dimensions = [
    result.byCli,
    result.byHost,
    result.byProvider,
    result.byModel,
    result.byProject,
    result.daily
  ]
  for (const rows of dimensions) {
    for (const field of ADDITIVE_FIELDS) {
      expect(
        rows.reduce((sum, entry) => sum + entry[field], 0),
        field
      ).toBe(result.totals[field])
    }
    for (const field of ['reportedCostUsd', 'estimatedCostUsd'] as const) {
      const parts = rows.map((entry) => entry[field])
      const sum = parts.some((part) => part !== null)
        ? parts.reduce<number>((acc, part) => acc + (part ?? 0), 0)
        : null
      expect(sum, field).toEqual(result.totals[field])
    }
  }
  expect(result.totals.pricedTokens + result.totals.unpricedTokens).toBe(result.totals.totalTokens)
}

describe('queryUsage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-12T12:00:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sums every dimension to the same totals under any filter', () => {
    const filterSets: Partial<UsageQueryFilters>[] = [
      {},
      { scope: 'orca' },
      { range: '7d' },
      { hostIds: ['ssh:cloud'] },
      { hostIds: ['local'], clis: ['claude'] },
      { providers: ['openai', 'bytedance'] },
      { models: ['unknown'] },
      { projectKeys: ['ssh:cloud|cwd:/srv/app'] },
      { scope: 'orca', clis: ['codex', 'claude'], range: '30d' }
    ]
    for (const filters of filterSets) {
      expectDimensionsToSumToTotals(query(filters))
    }
  })

  it('keeps reported and estimated costs apart and never turns unpriced tokens into free ones', () => {
    const { totals } = query()
    expect(totals.reportedCostUsd).toBe(2)
    expect(totals.estimatedCostUsd).toBe(2)
    expect(totals.unpricedTokens).toBe(400)
    expect(totals.pricedTokens).toBe(600)
  })

  it('reports no cost at all, rather than zero, when a filter leaves only unpriced rows', () => {
    const { totals } = query({ clis: ['trae'] })
    expect(totals.reportedCostUsd).toBeNull()
    expect(totals.estimatedCostUsd).toBeNull()
    expect(totals.unpricedTokens).toBe(totals.totalTokens)
  })

  it('narrows to the Orca-managed scope', () => {
    const { totals } = query({ scope: 'orca' })
    expect(totals.totalTokens).toBe(600)
    expect(totals.sessions).toBe(1)
  })

  it('filters by host, CLI, provider, model and project independently', () => {
    expect(query({ hostIds: ['ssh:cloud'] }).totals.totalTokens).toBe(400)
    expect(query({ clis: ['codex'] }).totals.totalTokens).toBe(200)
    expect(query({ providers: ['anthropic'] }).totals.totalTokens).toBe(400)
    expect(query({ models: ['unknown'] }).totals.totalTokens).toBe(200)
    expect(query({ projectKeys: ['worktree:w2'] }).totals.totalTokens).toBe(200)
  })

  it('applies the day window to rows and to sessions', () => {
    vi.setSystemTime(new Date('2026-06-12T12:00:00'))
    expect(query({ range: '7d' }).totals.totalTokens).toBe(1000)
    vi.setSystemTime(new Date('2026-07-30T12:00:00'))
    const old = query({ range: '30d' })
    expect(old.totals.totalTokens).toBe(0)
    expect(old.totals.sessions).toBe(0)
  })

  it('counts a session once per filter and keeps option lists stable while filtering', () => {
    const filtered = query({ hostIds: ['local'] })
    expect(filtered.totals.sessions).toBe(1)
    expect(filtered.options.hosts.map((option) => option.key).sort()).toEqual([
      'local',
      'ssh:cloud'
    ])
    expect(filtered.options.clis.map((option) => option.label)).toEqual(['Claude', 'Codex', 'Trae'])
  })

  it('labels hosts, CLIs, providers and unknown models', () => {
    const result = query()
    expect(result.byHost.find((entry) => entry.key === 'ssh:cloud')?.label).toBe('cloud')
    expect(result.byProvider.find((entry) => entry.key === 'unknown')?.label).toBe(
      'Unknown provider'
    )
    expect(result.byModel.find((entry) => entry.key === 'unknown')?.label).toBe('Unknown model')
  })

  it('keeps two hosts sharing a directory string as separate projects', () => {
    const result = queryUsage({
      rows: [
        row({ projectKey: 'cwd:/srv/app', worktreeId: null }),
        row({ hostId: 'ssh:cloud', projectKey: 'ssh:cloud|cwd:/srv/app', worktreeId: null })
      ],
      sessions: [],
      labels: LABELS,
      filters: { ...DEFAULT_USAGE_QUERY_FILTERS, scope: 'all', range: 'all' }
    })
    expect(result.byProject).toHaveLength(2)
  })
})
