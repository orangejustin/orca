import { describe, expect, it } from 'vitest'
import type { UsageRow, UsageSessionRef } from '../query/unified-usage-row'
import { mergeHostUsageFiles, type HostUsageFile } from './usage-host-merge'

function row(hostId: string, totalTokens: number, overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    cli: 'claude',
    hostId,
    day: '2026-06-10',
    model: 'claude-opus-4-5',
    provider: 'anthropic',
    projectKey: 'worktree:w1',
    projectLabel: 'app',
    worktreeId: 'w1',
    events: 1,
    freshInputTokens: totalTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens,
    costUsd: null,
    costBasis: 'unknown',
    pricedTokens: 0,
    unpricedTokens: totalTokens,
    ...overrides
  }
}

function session(hostId: string, sessionId: string, cli = 'claude'): UsageSessionRef {
  return {
    cli,
    hostId,
    sessionId,
    lastDay: '2026-06-10',
    worktreeIds: ['w1'],
    modelKeys: ['claude-opus-4-5'],
    projectKeys: ['worktree:w1'],
    providers: ['anthropic']
  }
}

function file(
  hostId: string,
  digest: string | null,
  totalTokens: number,
  sessionIds: string[] = [],
  cli = 'claude'
): HostUsageFile {
  return {
    hostId,
    cli,
    digest,
    rows: [row(hostId, totalTokens, { cli })],
    sessions: sessionIds.map((id) => session(hostId, id, cli))
  }
}

const totalOf = (result: ReturnType<typeof mergeHostUsageFiles>): number =>
  result.rows.reduce((sum, entry) => sum + entry.totalTokens, 0)

describe('mergeHostUsageFiles', () => {
  it('counts a log copied to another host once, which a host-scoped key would not', () => {
    const original = file('local', 'digest-a', 100, ['s1'])
    const copyOnCloud = file('ssh:cloud', 'digest-a', 100, ['s1'])

    const merged = mergeHostUsageFiles([original, copyOnCloud], ['ssh:cloud'])

    expect(totalOf(merged)).toBe(100)
    expect(merged.duplicateFiles).toBe(1)
    expect(merged.overlappingSessions).toBe(0)
    // The naive reading (distinct host, so distinct data) double-counts the same history.
    expect(original.rows[0].totalTokens + copyOnCloud.rows[0].totalTokens).toBe(200)
  })

  it('keeps the local copy whatever order the files arrive in', () => {
    const local = file('local', 'digest-a', 100)
    const cloud = file('ssh:cloud', 'digest-a', 100)
    for (const order of [
      [local, cloud],
      [cloud, local]
    ]) {
      const merged = mergeHostUsageFiles(order, ['ssh:cloud'])
      expect(merged.rows.map((entry) => entry.hostId)).toEqual(['local'])
    }
  })

  it('picks the same winner among remote hosts regardless of which answered first', () => {
    const a = file('ssh:a', 'digest-a', 100)
    const b = file('ssh:b', 'digest-a', 100)
    const hostOrder = ['ssh:a', 'ssh:b']
    expect(mergeHostUsageFiles([b, a], hostOrder).rows.map((entry) => entry.hostId)).toEqual([
      'ssh:a'
    ])
    expect(mergeHostUsageFiles([a, b], hostOrder).rows.map((entry) => entry.hostId)).toEqual([
      'ssh:a'
    ])
  })

  it('counts files with different contents separately', () => {
    const merged = mergeHostUsageFiles(
      [file('local', 'digest-a', 100), file('ssh:cloud', 'digest-b', 50)],
      ['ssh:cloud']
    )
    expect(totalOf(merged)).toBe(150)
    expect(merged.duplicateFiles).toBe(0)
  })

  it('never treats files that own nothing as copies of each other', () => {
    const merged = mergeHostUsageFiles(
      [file('local', null, 10), file('ssh:cloud', null, 20)],
      ['ssh:cloud']
    )
    expect(totalOf(merged)).toBe(30)
  })

  it('does not match identical digests across different CLIs', () => {
    const merged = mergeHostUsageFiles(
      [file('local', 'same', 10, [], 'claude'), file('local', 'same', 20, [], 'codex')],
      []
    )
    expect(totalOf(merged)).toBe(30)
  })

  it('flags a session that exists on two hosts with different contents', () => {
    const merged = mergeHostUsageFiles(
      [file('local', 'digest-a', 100, ['shared']), file('ssh:cloud', 'digest-b', 140, ['shared'])],
      ['ssh:cloud']
    )
    // Both copies stay in the totals; the count says the figure may overstate.
    expect(totalOf(merged)).toBe(240)
    expect(merged.overlappingSessions).toBe(1)
  })

  it('does not call a session overlapping just because several of its files are on one host', () => {
    const merged = mergeHostUsageFiles(
      [file('local', 'digest-a', 10, ['s1']), file('local', 'digest-b', 20, ['s1'])],
      []
    )
    expect(merged.overlappingSessions).toBe(0)
    expect(merged.sessions).toHaveLength(1)
  })

  it('does not report a session as overlapping once its duplicate file is dropped', () => {
    const merged = mergeHostUsageFiles(
      [file('local', 'digest-a', 100, ['s1']), file('ssh:cloud', 'digest-a', 100, ['s1'])],
      ['ssh:cloud']
    )
    expect(merged.sessions.map((entry) => entry.hostId)).toEqual(['local'])
    expect(merged.overlappingSessions).toBe(0)
  })

  it('does not mutate the files it was given', () => {
    const files = [file('local', 'digest-a', 10, ['s1']), file('local', 'digest-b', 20, ['s1'])]
    const before = JSON.stringify(files)
    mergeHostUsageFiles(files, [])
    expect(JSON.stringify(files)).toBe(before)
  })
})
