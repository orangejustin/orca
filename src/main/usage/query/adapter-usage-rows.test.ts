import { describe, expect, it } from 'vitest'
import { claudeUsageRows } from '../../claude-usage/claude-usage-rows'
import type { ClaudeUsageDailyAggregate } from '../../claude-usage/types'
import { codexUsageRows } from '../../codex-usage/codex-usage-rows'
import type { CodexUsageDailyAggregate } from '../../codex-usage/types'
import { museUsageRows } from '../../muse-usage/muse-usage-rows'
import type { MuseUsageDailyAggregate } from '../../muse-usage/types'
import { openCodeUsageRows } from '../../opencode-usage/opencode-usage-rows'
import type { OpenCodeUsageDailyAggregate } from '../../opencode-usage/types'
import { hostScopedProjectKey, sumUsageRowTokens } from './unified-usage-row'

const COMMON = {
  day: '2026-06-10',
  projectKey: 'cwd:/srv/app',
  projectLabel: 'srv/app',
  repoId: null,
  worktreeId: null
}

describe('adapter usage rows', () => {
  it('keeps Claude cache buckets beside input', () => {
    const daily: ClaudeUsageDailyAggregate = {
      ...COMMON,
      model: 'claude-opus-4-5',
      turnCount: 3,
      zeroCacheReadTurnCount: 0,
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 4_000,
      cacheWriteTokens: 200,
      cacheWrite1hTokens: 0
    }
    const [mapped] = claudeUsageRows([daily], 'local')
    expect(mapped).toMatchObject({
      freshInputTokens: 1_000,
      cacheReadTokens: 4_000,
      cacheWriteTokens: 200,
      outputTokens: 500,
      totalTokens: 5_700,
      events: 3,
      provider: 'anthropic',
      costBasis: 'estimated',
      unpricedTokens: 0
    })
  })

  it('carves Codex cache out of input and leaves reasoning inside output', () => {
    const daily: CodexUsageDailyAggregate = {
      ...COMMON,
      model: 'gpt-5.4',
      eventCount: 2,
      inputTokens: 2_000,
      cachedInputTokens: 800,
      outputTokens: 1_200,
      reasoningOutputTokens: 300,
      totalTokens: 3_200,
      hasInferredPricing: false,
      longContextInputTokens: 0,
      longContextCachedInputTokens: 0,
      longContextOutputTokens: 0
    }
    const [mapped] = codexUsageRows([daily], 'local')
    expect(mapped).toMatchObject({
      freshInputTokens: 1_200,
      cacheReadTokens: 800,
      outputTokens: 1_200,
      reasoningTokens: 300,
      totalTokens: 3_200
    })
    expect(sumUsageRowTokens(mapped)).toBe(daily.totalTokens)
  })

  it('adds OpenCode reasoning to output and splits cache reads from writes', () => {
    const daily: OpenCodeUsageDailyAggregate = {
      ...COMMON,
      model: 'gpt-5.4',
      eventCount: 1,
      inputTokens: 700,
      cachedInputTokens: 600,
      cacheWriteInputTokens: 100,
      outputTokens: 100,
      reasoningOutputTokens: 50,
      totalTokens: 850,
      estimatedCostUsd: 0.42
    }
    const [mapped] = openCodeUsageRows([daily], 'local')
    expect(mapped).toMatchObject({
      freshInputTokens: 100,
      cacheReadTokens: 500,
      cacheWriteTokens: 100,
      outputTokens: 150,
      reasoningTokens: 50,
      totalTokens: 850,
      costUsd: 0.42,
      costBasis: 'reported'
    })
  })

  it('leaves a Muse row unpriced instead of free', () => {
    const daily: MuseUsageDailyAggregate = {
      ...COMMON,
      model: 'doubao-seed-1.6',
      eventCount: 1,
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 20,
      reasoningOutputTokens: 5,
      totalTokens: 120
    }
    const [mapped] = museUsageRows([daily], 'local')
    expect(mapped).toMatchObject({
      costUsd: null,
      costBasis: 'unknown',
      pricedTokens: 0,
      unpricedTokens: 120,
      provider: 'bytedance'
    })
  })

  it('clamps cached tokens that exceed input instead of going negative', () => {
    const daily: MuseUsageDailyAggregate = {
      ...COMMON,
      model: null,
      eventCount: 1,
      inputTokens: 10,
      cachedInputTokens: 99,
      outputTokens: 5,
      reasoningOutputTokens: 9,
      totalTokens: 15
    }
    const [mapped] = museUsageRows([daily], 'local')
    expect(mapped.freshInputTokens).toBe(0)
    expect(mapped.cacheReadTokens).toBe(10)
    expect(mapped.reasoningTokens).toBe(5)
    expect(mapped.provider).toBe('unknown')
  })

  it('scopes path-derived project keys to their host but not worktree keys', () => {
    expect(hostScopedProjectKey('local', 'cwd:/srv/app')).toBe('cwd:/srv/app')
    expect(hostScopedProjectKey('ssh:cloud', 'cwd:/srv/app')).toBe('ssh:cloud|cwd:/srv/app')
    expect(hostScopedProjectKey('ssh:cloud', 'unscoped')).toBe('ssh:cloud|unscoped')
    expect(hostScopedProjectKey('ssh:cloud', 'worktree:w1')).toBe('worktree:w1')
  })
})
