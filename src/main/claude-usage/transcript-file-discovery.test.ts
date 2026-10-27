import { describe, expect, it } from 'vitest'
import { resolveClaudeTranscriptRoots } from './transcript-file-discovery'

const norm = (paths: string[]): string[] => paths.map((entry) => entry.replaceAll('\\', '/'))

describe('resolveClaudeTranscriptRoots', () => {
  it('reads the default config dir', () => {
    expect(norm(resolveClaudeTranscriptRoots({}, '/h'))).toEqual([
      '/h/.claude/projects',
      '/h/.claude/transcripts'
    ])
  })

  it('reads a CLAUDE_CONFIG_DIR override and still keeps the default for older history', () => {
    expect(norm(resolveClaudeTranscriptRoots({ CLAUDE_CONFIG_DIR: '/cfg' }, '/h'))).toEqual([
      '/cfg/projects',
      '/cfg/transcripts',
      '/h/.claude/projects',
      '/h/.claude/transcripts'
    ])
  })

  it('does not list a root twice when the override is the default', () => {
    expect(
      norm(resolveClaudeTranscriptRoots({ CLAUDE_CONFIG_DIR: '/h/.claude' }, '/h'))
    ).toHaveLength(2)
  })

  it('ignores a blank override', () => {
    expect(resolveClaudeTranscriptRoots({ CLAUDE_CONFIG_DIR: '   ' }, '/h')).toHaveLength(2)
  })
})
