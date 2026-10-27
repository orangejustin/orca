import { runUsageScanJob, type UsageScanJobInput } from './usage-scan-job'

// Entry of the forked usage scan child: one job in over IPC, one result out, then exit. The
// parent sets TZ in this process's environment, which the scanners' local-day bucketing reads.

function isJobInput(value: unknown): value is UsageScanJobInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    'cli' in value &&
    typeof value.cli === 'string' &&
    'timeZone' in value &&
    typeof value.timeZone === 'string' &&
    'cacheFile' in value &&
    typeof value.cacheFile === 'string' &&
    'worktrees' in value &&
    Array.isArray(value.worktrees)
  )
}

function finish(message: unknown): void {
  if (!process.send) {
    process.exit(1)
  }
  process.send(message, () => process.exit(0))
}

process.once('message', (message: unknown) => {
  const input =
    typeof message === 'object' && message !== null && 'input' in message ? message.input : null
  if (!isJobInput(input)) {
    finish({ ok: false, error: 'Malformed usage scan job' })
    return
  }
  runUsageScanJob(input)
    .then((output) => finish({ ok: true, output }))
    .catch((error: unknown) =>
      finish({ ok: false, error: error instanceof Error ? error.message : String(error) })
    )
})
