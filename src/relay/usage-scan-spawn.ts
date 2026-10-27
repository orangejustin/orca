import { fork } from 'node:child_process'
import { join } from 'node:path'
import { pickAllowedEnv, RUNTIME_ENV_ALLOWLIST } from '../main/ai-vault/session-scanner-service-env'
import { lowerAiVaultServicePriority } from '../main/ai-vault/session-scanner-service-priority'
import { usageScanOutputSchema } from '../shared/usage-scan-relay'
import type { UsageScanJobInput, UsageScanJobOutput } from './usage-scan-job'

export const RELAY_USAGE_SCAN_ENTRY_FILENAME = 'relay-usage-scan.js'
// A scan that walks a large history may legitimately take a while; this bounds a wedged one.
const USAGE_SCAN_CHILD_TIMEOUT_MS = 170_000

// Why: the roots each CLI resolves its logs from. Allowlisted, never `...process.env`, so an
// ambient NODE_OPTIONS or a shell-exported secret cannot reach the reader.
const USAGE_SCAN_ENV_ALLOWLIST = [
  ...RUNTIME_ENV_ALLOWLIST,
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'XDG_CACHE_HOME',
  'ORCA_TRAE_USAGE_ROOTS'
] as const

export function buildRelayUsageScanEnv(
  timeZone: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  // Why: a worker thread ignores its own TZ for Date, so the zone is set on a child process.
  return { ...pickAllowedEnv(USAGE_SCAN_ENV_ALLOWLIST, baseEnv, platform), TZ: timeZone }
}

export function runUsageScanInChild(
  input: UsageScanJobInput,
  signal?: AbortSignal,
  entryPath = join(__dirname, RELAY_USAGE_SCAN_ENTRY_FILENAME)
): Promise<UsageScanJobOutput> {
  return new Promise((resolve, reject) => {
    const child = fork(entryPath, [], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      execArgv: ['--max-old-space-size=768'],
      env: buildRelayUsageScanEnv(input.timeZone),
      ...(process.platform === 'win32' ? { windowsHide: true } : {})
    })
    lowerAiVaultServicePriority(child.pid)
    let settled = false
    let stderr = ''
    const settle = (finish: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      finish()
    }
    const onAbort = (): void => {
      child.kill()
      settle(() => reject(new Error('Usage scan was cancelled')))
    }
    const timer = setTimeout(() => {
      child.kill()
      settle(() => reject(new Error('Usage scan timed out')))
    }, USAGE_SCAN_CHILD_TIMEOUT_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2_000)
    })
    child.once('message', (message: unknown) => {
      const output =
        typeof message === 'object' && message !== null && 'ok' in message && message.ok === true
          ? usageScanOutputSchema.safeParse('output' in message ? message.output : null)
          : null
      if (output?.success) {
        settle(() => resolve(output.data))
        return
      }
      const reason =
        typeof message === 'object' && message !== null && 'error' in message
          ? String(message.error)
          : 'Usage scan failed'
      settle(() => reject(new Error(reason)))
    })
    child.once('error', (error) => settle(() => reject(error)))
    child.once('exit', (code) =>
      settle(() => reject(new Error(`Usage scan exited with code ${code}. ${stderr}`.trim())))
    )
    child.send({ input })
  })
}
