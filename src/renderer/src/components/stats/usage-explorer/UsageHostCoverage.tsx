import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import type {
  UsageDedupeNote,
  UsageHostCoverage as HostCoverage
} from '../../../../../shared/usage-service-types'
import { formatSyncedAt, hostStatusLabel, hostStatusNeedsAttention } from './usage-explorer-copy'

type UsageHostCoverageProps = {
  hosts: HostCoverage[]
  dedupe: UsageDedupeNote
  /** CLI id to display name. */
  cliLabels: Record<string, string>
  now: number
}

/**
 * Says which machines the numbers cover and how fresh each is. A host that could not be read is
 * named here with its last good sync, so a missing host is never mistaken for a quiet one.
 */
export function UsageHostCoverage({
  hosts,
  dedupe,
  cliLabels,
  now
}: UsageHostCoverageProps): React.JSX.Element {
  return (
    <section
      className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4"
      aria-label={translate('auto.components.stats.usage.explorer.coverageTitle', 'Coverage')}
    >
      <div>
        <h4 className="text-sm font-semibold text-foreground">
          {translate('auto.components.stats.usage.explorer.coverageTitle', 'Coverage')}
        </h4>
        <p className="text-xs text-muted-foreground">
          {hosts.length === 0
            ? translate(
                'auto.components.stats.usage.explorer.coverageLocalOnly',
                'This computer only. No SSH host is registered.'
              )
            : translate(
                'auto.components.stats.usage.explorer.coverageHosts',
                'This computer and {{value0}} SSH host(s). Each host reads its own logs and reports totals only.',
                { value0: hosts.length }
              )}
        </p>
      </div>
      {hosts.map((host) => (
        <div key={host.hostId} className="space-y-1.5" data-testid="usage-host-coverage-row">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            {host.label}
          </div>
          <ul className="space-y-1">
            {host.clis.map((entry) => {
              const attention = hostStatusNeedsAttention(entry.status)
              return (
                <li
                  key={entry.cli}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
                >
                  {attention ? (
                    <AlertCircle className="size-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <CheckCircle2 className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="text-foreground">{cliLabels[entry.cli] ?? entry.cli}</span>
                  <Badge variant={attention ? 'secondary' : 'outline'}>
                    {hostStatusLabel(entry.status)}
                  </Badge>
                  {entry.status === 'ok' ||
                  entry.status === 'stale' ||
                  entry.status === 'unavailable' ? (
                    <span className="text-muted-foreground">
                      {formatSyncedAt(entry.lastSuccessAt, now)}
                    </span>
                  ) : null}
                  {entry.message ? (
                    <span className="text-muted-foreground">{entry.message}</span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      {dedupe.duplicateFiles > 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.stats.usage.explorer.dedupeFiles',
            '{{value0}} log file(s) found on more than one host were counted once.',
            { value0: dedupe.duplicateFiles }
          )}
        </p>
      ) : null}
      {dedupe.overlappingSessions > 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.stats.usage.explorer.dedupeOverlap',
            '{{value0}} session(s) exist on several hosts with different contents. Both copies are counted, so their totals may be overstated.',
            { value0: dedupe.overlappingSessions }
          )}
        </p>
      ) : null}
    </section>
  )
}
