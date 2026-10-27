import { describe, expect, it } from 'vitest'
import { claudeRequestTierAboveTokens, estimateCostUsd } from './claude-model-pricing'
import { buildBreakdown, buildSummary } from './claude-usage-report-aggregation'
import { aggregateClaudeUsage, mergeClaudeDailyAggregates } from './usage-aggregation'
import type {
  ClaudeUsageAttributedTurn,
  ClaudeUsageDailyAggregate,
  ClaudeUsagePersistedState
} from './types'

function turn(
  model: string,
  overrides: Partial<ClaudeUsageAttributedTurn> = {}
): ClaudeUsageAttributedTurn {
  return {
    sessionId: 's1',
    timestamp: '2026-05-01T10:00:00.000Z',
    model,
    cwd: '/work/app',
    gitBranch: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    day: '2026-05-01',
    projectKey: 'worktree:w1',
    projectLabel: 'app',
    repoId: 'r1',
    worktreeId: 'w1',
    ...overrides
  }
}

function stateFrom(turns: ClaudeUsageAttributedTurn[]): ClaudeUsagePersistedState {
  const { sessions, dailyAggregates } = aggregateClaudeUsage(turns)
  return {
    schemaVersion: 7,
    worktreeFingerprint: null,
    processedFiles: [],
    sessions,
    dailyAggregates,
    scanState: {
      enabled: true,
      lastScanStartedAt: null,
      lastScanCompletedAt: null,
      lastScanError: null
    }
  }
}

describe('claudeRequestTierAboveTokens', () => {
  it('is null for models without a long-context tier and for unpriced models', () => {
    expect(claudeRequestTierAboveTokens('claude-opus-4-5', 500_000, 0, 0, 0)).toBeNull()
    expect(claudeRequestTierAboveTokens('claude-sonnet-4-6', 500_000, 0, 0, 0)).toBeNull()
    expect(claudeRequestTierAboveTokens('my-gateway-model', 500_000, 0, 0, 0)).toBeNull()
    expect(claudeRequestTierAboveTokens(null, 500_000, 0, 0, 0)).toBeNull()
  })

  it('counts only the part of each bucket above the threshold', () => {
    expect(claudeRequestTierAboveTokens('claude-sonnet-4-5', 250_000, 10_000, 300_000, 0)).toEqual({
      input: 50_000,
      output: 0,
      cacheRead: 100_000,
      cacheWrite5m: 0,
      cacheWrite1h: 0
    })
  })

  it('shares one allowance between the 5m and 1h cache-write buckets', () => {
    expect(
      claudeRequestTierAboveTokens('claude-sonnet-4-5', 0, 0, 0, 400_000, 200_000)
    ).toMatchObject({ cacheWrite5m: 100_000, cacheWrite1h: 100_000 })
  })
})

describe('estimateCostUsd with per-request tier sums', () => {
  it.each([
    [0, 0, 0, 400_000, 200_000],
    [250_000, 10_000, 300_000, 0, 0],
    [100_000, 5_000, 50_000, 20_000, 5_000],
    [1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000]
  ])(
    'matches the single-request threshold for one request (%#)',
    (input, output, read, write, write1h) => {
      const above = claudeRequestTierAboveTokens(
        'claude-sonnet-4-5',
        input,
        output,
        read,
        write,
        write1h
      )!
      expect(
        estimateCostUsd('claude-sonnet-4-5', input, output, read, write, write1h, above)
      ).toBeCloseTo(estimateCostUsd('claude-sonnet-4-5', input, output, read, write, write1h)!)
    }
  )
})

describe('Claude cost across many requests', () => {
  it('does not apply the long-context rate to a day of small requests', () => {
    // Two 150k-token prompts: each is below the 200k tier, so both bill at $3/MTok.
    const state = stateFrom([
      turn('claude-sonnet-4-5', { inputTokens: 150_000 }),
      turn('claude-sonnet-4-5', { inputTokens: 150_000 })
    ])
    const summary = buildSummary(state, 'all', 'all')
    expect(summary.estimatedCostUsd).toBeCloseTo(0.9)
    // The pre-fix aggregate path priced the 300k total as 200k @ $3 + 100k @ $6.
    expect(estimateCostUsd('claude-sonnet-4-5', 300_000, 0, 0, 0)).toBeCloseTo(1.2)
  })

  it('still charges the long-context rate for the request that exceeds the tier', () => {
    const state = stateFrom([
      turn('claude-sonnet-4-5', { inputTokens: 250_000 }),
      turn('claude-sonnet-4-5', { inputTokens: 100_000 })
    ])
    // 250k request: 200k @ $3 + 50k @ $6 = $0.90; 100k request: $0.30.
    expect(buildSummary(state, 'all', 'all').estimatedCostUsd).toBeCloseTo(1.2)
  })

  it('prices the model breakdown per row rather than over the whole range', () => {
    const state = stateFrom([
      turn('claude-sonnet-4-5', { inputTokens: 150_000 }),
      turn('claude-sonnet-4-5', {
        inputTokens: 150_000,
        timestamp: '2026-05-02T10:00:00.000Z',
        day: '2026-05-02'
      })
    ])
    const rows = buildBreakdown(state, 'all', 'all', 'model')
    expect(rows.find((row) => row.key === 'claude-sonnet-4-5')?.estimatedCostUsd).toBeCloseTo(0.9)
  })

  it('keeps tier sums when daily aggregates from two files merge, without sharing objects', () => {
    const first = aggregateClaudeUsage([
      turn('claude-sonnet-4-5', { inputTokens: 250_000 })
    ]).dailyAggregates
    const second = aggregateClaudeUsage([
      turn('claude-sonnet-4-5', { inputTokens: 300_000 })
    ]).dailyAggregates
    const merged = new Map<string, ClaudeUsageDailyAggregate>()
    mergeClaudeDailyAggregates(merged, first)
    mergeClaudeDailyAggregates(merged, second)
    expect([...merged.values()][0].tierAboveTokens?.input).toBe(150_000)
    // Merging must not mutate the source rows, or a cached file would drift on every rescan.
    expect(first[0].tierAboveTokens?.input).toBe(50_000)
  })
})

describe('Claude unpriced models', () => {
  it('flags unpriced tokens instead of treating them as free', () => {
    const state = stateFrom([
      turn('claude-opus-4-5', { inputTokens: 1_000_000 }),
      turn('my-gateway-model', { inputTokens: 1_000_000 })
    ])
    const summary = buildSummary(state, 'all', 'all')
    expect(summary.estimatedCostUsd).toBeCloseTo(5)
    expect(summary.hasUnpricedModels).toBe(true)
    expect(summary.pricedTokenShare).toBeCloseTo(0.5)

    const rows = buildBreakdown(state, 'all', 'all', 'model')
    const unknown = rows.find((row) => row.key === 'my-gateway-model')
    expect(unknown?.estimatedCostUsd).toBeNull()
    expect(unknown?.hasUnpricedTokens).toBe(true)
    expect(rows.find((row) => row.key === 'claude-opus-4-5')?.hasUnpricedTokens).toBe(false)
  })

  it('reports no cost at all when every model is unpriced', () => {
    const summary = buildSummary(
      stateFrom([turn('my-gateway-model', { inputTokens: 10_000 })]),
      'all',
      'all'
    )
    expect(summary.estimatedCostUsd).toBeNull()
    expect(summary.hasUnpricedModels).toBe(true)
    expect(summary.pricedTokenShare).toBe(0)
  })

  it('has full coverage when everything is priced', () => {
    const summary = buildSummary(
      stateFrom([turn('claude-opus-4-5', { inputTokens: 10_000 })]),
      'all',
      'all'
    )
    expect(summary.hasUnpricedModels).toBe(false)
    expect(summary.pricedTokenShare).toBe(1)
  })
})
