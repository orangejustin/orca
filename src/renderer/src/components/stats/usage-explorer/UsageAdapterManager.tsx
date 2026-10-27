import { ChevronDown, EyeOff, Eye } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import type { UsageAdapterInfo, UsagePreferences } from '../../../../../shared/usage-service-types'

type UsageAdapterManagerProps = {
  adapters: UsageAdapterInfo[]
  unsupportedClis: { id: string; label: string }[]
  preferences: UsagePreferences
  now: number
  onSetCollecting: (cli: string, enabled: boolean) => void
  onSetPreferences: (preferences: UsagePreferences) => void
}

function without(list: readonly string[], id: string): string[] {
  return list.filter((entry) => entry !== id)
}

function scanLine(adapter: UsageAdapterInfo, now: number): string {
  if (adapter.isScanning) {
    return translate('auto.components.stats.usage.explorer.adapterScanning', 'Scanning…')
  }
  if (adapter.lastScanCompletedAt === null) {
    return translate('auto.components.stats.usage.explorer.adapterNotScanned', 'Not scanned yet')
  }
  return translate('auto.components.stats.usage.explorer.adapterScanned', 'Scanned {{value0}}', {
    value0: formatUiRelativeTime(adapter.lastScanCompletedAt - now)
  })
}

function AdapterRow({
  adapter,
  now,
  preferences,
  onSetCollecting,
  onSetPreferences
}: Omit<UsageAdapterManagerProps, 'adapters' | 'unsupportedClis'> & {
  adapter: UsageAdapterInfo
}): React.JSX.Element {
  const collectId = `usage-collect-${adapter.id}`
  const countId = `usage-count-${adapter.id}`
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2"
      data-testid={`usage-adapter-${adapter.id}`}
    >
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{adapter.label}</span>
          {adapter.logFormatVerified ? null : (
            <Badge variant="secondary">
              {translate(
                'auto.components.stats.usage.explorer.adapterUnverified',
                'Log format not checked against a real capture'
              )}
            </Badge>
          )}
          {adapter.excluded ? (
            <Badge variant="outline">
              {translate(
                'auto.components.stats.usage.explorer.adapterExcluded',
                'Left out of totals'
              )}
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {adapter.collecting
            ? scanLine(adapter, now)
            : translate(
                'auto.components.stats.usage.explorer.adapterPaused',
                'Collection is off. Earlier history is kept.'
              )}
          {adapter.hasData
            ? ''
            : ` · ${translate('auto.components.stats.usage.explorer.adapterNoData', 'No data')}`}
        </p>
        {adapter.lastScanError ? (
          <p className="text-xs text-destructive">{adapter.lastScanError}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch
            id={collectId}
            checked={adapter.collecting}
            onCheckedChange={(enabled) => onSetCollecting(adapter.id, enabled)}
          />
          <Label htmlFor={collectId}>
            {translate('auto.components.stats.usage.explorer.adapterCollect', 'Collect')}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id={countId}
            checked={!adapter.excluded}
            onCheckedChange={(counted) =>
              onSetPreferences({
                ...preferences,
                excludedClis: counted
                  ? without(preferences.excludedClis, adapter.id)
                  : [...preferences.excludedClis, adapter.id]
              })
            }
          />
          <Label htmlFor={countId}>
            {translate('auto.components.stats.usage.explorer.adapterCount', 'Count in totals')}
          </Label>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() =>
            onSetPreferences({
              ...preferences,
              hiddenClis: adapter.hidden
                ? without(preferences.hiddenClis, adapter.id)
                : [...preferences.hiddenClis, adapter.id]
            })
          }
        >
          {adapter.hidden ? <Eye /> : <EyeOff />}
          {adapter.hidden
            ? translate('auto.components.stats.usage.explorer.adapterShow', 'Show')
            : translate('auto.components.stats.usage.explorer.adapterHide', 'Hide')}
        </Button>
      </div>
    </li>
  )
}

export function UsageAdapterManager(props: UsageAdapterManagerProps): React.JSX.Element {
  const { adapters, unsupportedClis } = props
  const shown = adapters.filter((adapter) => !adapter.hidden)
  const hidden = adapters.filter((adapter) => adapter.hidden)

  return (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <Collapsible>
        <div className="p-4">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <span>
                <span className="block text-sm font-semibold text-foreground">
                  {translate('auto.components.stats.usage.explorer.manageTitle', 'CLIs')}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {translate(
                    'auto.components.stats.usage.explorer.manageSummary',
                    '{{value0}} with a usage adapter, {{value1}} hidden',
                    { value0: adapters.length, value1: hidden.length }
                  )}
                </span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="space-y-3 px-4 pb-4">
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.stats.usage.explorer.manageHelp',
                'Collect keeps reading a CLI’s logs; turning it off keeps its history. Count in totals leaves a CLI out of the numbers without stopping collection. Hide also removes it from this list.'
              )}
            </p>
            <ul className="divide-y divide-border/40">
              {shown.map((adapter) => (
                <AdapterRow key={adapter.id} {...props} adapter={adapter} />
              ))}
            </ul>
            {hidden.length > 0 ? (
              <div className="space-y-1">
                <h5 className="text-xs font-medium text-muted-foreground">
                  {translate('auto.components.stats.usage.explorer.hiddenTitle', 'Hidden')}
                </h5>
                <ul className="divide-y divide-border/40">
                  {hidden.map((adapter) => (
                    <AdapterRow key={adapter.id} {...props} adapter={adapter} />
                  ))}
                </ul>
              </div>
            ) : null}
            {unsupportedClis.length > 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="usage-unsupported-clis">
                {translate(
                  'auto.components.stats.usage.explorer.unsupported',
                  'No usage adapter yet: {{value0}}. Orca reads token counts from a CLI’s own logs and does not estimate them from terminal output.',
                  { value0: unsupportedClis.map((cli) => cli.label).join(', ') }
                )}
              </p>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
