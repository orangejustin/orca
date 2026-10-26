import type { AgentProviderSessionMetadata } from '../../../../shared/agent-session-resume'
import { claudeConfigDirFromTranscriptPath } from '../../../../shared/claude-transcript-config-dir'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV
} from '../../../../shared/claude-profile-routing'
import { MANAGED_DATA_ACCOUNT_RESUME_ENV } from '../../../../shared/managed-data-account-resume'
import { managedAccountLaunchEnvironment } from '../../../managed-data-accounts/launch-environment'
import { getManagedDataAccountService } from '../../../managed-data-accounts/service'
import { prepareCodexResumeHome, resolveCodexResumeLaunch } from '../host-env/codex-resume'
import type { PrepareCodexSessionResume } from '../host-env/types'

/**
 * Drops the live Claude profile pointer so a recorded config dir is not replaced
 * by the account currently selected in Settings.
 */
export function preserveRecordedClaudeLaunchEnv(
  env: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!env) {
    return env
  }
  const next = { ...env }
  delete next[CLAUDE_PROFILE_POINTER_ENV]
  delete next[CLAUDE_INJECTED_CONFIG_DIR_ENV]
  return next
}

/**
 * A missing CLAUDE_CONFIG_DIR is not a default account. Pin the transcript's
 * config dir, or refuse before the old process stops.
 */
export function prepareStrictClaudeRestart(args: {
  resumeOnSelectedAccount?: boolean
  launchAgent?: string
  env?: Record<string, string>
  resumeProviderSession?: AgentProviderSessionMetadata
}): string | null {
  if (args.resumeOnSelectedAccount !== false || args.launchAgent !== 'claude') {
    return null
  }
  if (args.env?.CLAUDE_CONFIG_DIR?.trim()) {
    return null
  }
  const home = claudeConfigDirFromTranscriptPath(
    args.resumeProviderSession?.transcriptPath,
    args.resumeProviderSession?.id
  )
  if (!home) {
    return 'session restart could not prove the original Claude account'
  }
  args.env = { ...args.env, CLAUDE_CONFIG_DIR: home }
  return null
}

/** Session restart must name its recorded account before the old process is stopped. */
export function recordedSessionRestartRefusal(args: {
  resumeOnSelectedAccount?: boolean
  launchAgent?: string
  env?: Record<string, string> | null
}): string | null {
  if (args.resumeOnSelectedAccount !== false || !args.launchAgent) {
    return null
  }
  const accountId = args.env?.[MANAGED_DATA_ACCOUNT_RESUME_ENV]?.trim()
  if (accountId && (args.launchAgent === 'opencode' || args.launchAgent === 'opencode2')) {
    const pinned = managedAccountLaunchEnvironment(
      getManagedDataAccountService(),
      'opencode',
      accountId,
      { strict: true }
    )
    if (!pinned.XDG_DATA_HOME) {
      return 'session restart requires the recorded account'
    }
  }
  return null
}

/**
 * Runs Codex resume preparation before the old process is stopped.
 * A fresh or dropped resume must not kill the pane and then start a new chat.
 */
export async function strictCodexSessionRestartRefusal(
  prepare: PrepareCodexSessionResume | undefined,
  args: {
    resumeOnSelectedAccount?: boolean
    launchAgent?: string
    command?: string
    env?: Record<string, string> | null
    resumeProviderSession?: AgentProviderSessionMetadata
    connectionId?: string | null
  }
): Promise<string | null> {
  const recorded = recordedSessionRestartRefusal(args)
  if (recorded || args.resumeOnSelectedAccount !== false || args.launchAgent !== 'codex') {
    return recorded
  }
  const prepared = prepareCodexResumeHome(prepare, {
    connectionId: args.connectionId,
    launchAgent: 'codex',
    providerSession: args.resumeProviderSession,
    target: { runtime: 'host' },
    launchEnv: args.env ?? undefined
  })
  if (!prepared) {
    return 'session restart could not verify the Codex session'
  }
  try {
    const launch = await resolveCodexResumeLaunch(args.command, prepared)
    if (launch.droppedResumeArgv || launch.notifyResumeUnavailable || !launch.codexResumeHome) {
      return 'session restart would start a new Codex chat'
    }
  } catch (error) {
    return error instanceof Error
      ? error.message
      : 'session restart could not verify the Codex session'
  }
  return null
}
