import { describe, expect, it, vi } from 'vitest'
import {
  prepareStrictClaudeRestart,
  recordedSessionRestartRefusal,
  strictCodexSessionRestartRefusal
} from './spawn-recorded-account'

describe('recordedSessionRestartRefusal', () => {
  it('lets an account-switch restart keep the selected account', () => {
    expect(
      recordedSessionRestartRefusal({
        launchAgent: 'codex',
        env: {}
      })
    ).toBeNull()
  })

  it('does not treat a missing Codex home as unknown, and skips an unproven Claude home', () => {
    expect(
      recordedSessionRestartRefusal({
        resumeOnSelectedAccount: false,
        launchAgent: 'codex',
        env: {}
      })
    ).toBeNull()
    expect(
      prepareStrictClaudeRestart({
        resumeOnSelectedAccount: false,
        launchAgent: 'claude',
        env: {}
      })
    ).toMatch(/could not prove the original Claude account/)
  })

  it('refuses before stop when Codex preparation would start a fresh chat', async () => {
    const prepare = vi.fn(async () => ({ outcome: 'fresh' as const, claimedCodexProvenance: true }))
    await expect(
      strictCodexSessionRestartRefusal(prepare, {
        resumeOnSelectedAccount: false,
        launchAgent: 'codex',
        command: "codex resume 'sess-1'",
        env: { CODEX_HOME: '/accounts/work' },
        resumeProviderSession: { key: 'session_id', id: 'sess-1' }
      })
    ).resolves.toMatch(/new Codex chat|could not verify the originating Codex session/)
    expect(prepare).toHaveBeenCalled()
  })

  it('pins a managed Claude home from the session transcript when launch env is empty', () => {
    const env: Record<string, string> = { ORCA_PANE_KEY: 'pane' }
    const args = {
      resumeOnSelectedAccount: false as const,
      launchAgent: 'claude' as const,
      env,
      resumeProviderSession: {
        key: 'session_id' as const,
        id: 'sess-1',
        transcriptPath: '/accounts/A/projects/-repo/sess-1.jsonl'
      }
    }
    expect(prepareStrictClaudeRestart(args)).toBeNull()
    expect(args.env.CLAUDE_CONFIG_DIR).toBe('/accounts/A')
  })

  it('keeps an account-switch restart on the selected-account path', async () => {
    const prepare = vi.fn(async () => ({ outcome: 'fresh' as const, claimedCodexProvenance: true }))
    await expect(
      strictCodexSessionRestartRefusal(prepare, {
        launchAgent: 'codex',
        env: { CODEX_HOME: '/accounts/work' },
        resumeProviderSession: { key: 'session_id', id: 'sess-1' }
      })
    ).resolves.toBeNull()
    expect(prepare).not.toHaveBeenCalled()
  })
})
