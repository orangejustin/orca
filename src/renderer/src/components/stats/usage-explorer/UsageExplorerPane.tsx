import { useEffect, useMemo } from 'react'
import {
  AlertCircle,
  CalendarDays,
  Layers,
  Loader2,
  RefreshCw,
  Server,
  Sparkles
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { StatCard } from '../StatCard'
import { formatTokens } from '../usage-formatters'
import { populationLabel } from './usage-explorer-copy'
import { useUsageExplorer } from './usage-explorer-store'
import { UsageAdapterManager } from './UsageAdapterManager'
import { UsageBreakdownTabs } from './UsageBreakdownTabs'
import { UsageCostSection } from './UsageCostSection'
import { UsageDailyChart } from './UsageDailyChart'
import { UsageExplorerFilters } from './UsageExplorerFilters'
import { UsageHostCoverage } from './UsageHostCoverage'

export function UsageExplorerPane(): React.JSX.Element {
  const snapshot = useUsageExplorer((state) => state.snapshot)
  const status = useUsageExplorer((state) => state.status)
  const error = useUsageExplorer((state) => state.error)
  const filters = useUsageExplorer((state) => state.filters)
  const refreshing = useUsageExplorer((state) => state.refreshing)
  const syncing = useUsageExplorer((state) => state.syncing)
  const open = useUsageExplorer((state) => state.open)
  const refresh = useUsageExplorer((state) => state.refresh)
  const syncHosts = useUsageExplorer((state) => state.syncHosts)
  const setFilters = useUsageExplorer((state) => state.setFilters)
  const resetFilters = useUsageExplorer((state) => state.resetFilters)
  const setCollecting = useUsageExplorer((state) => state.setCollecting)
  const setPreferences = useUsageExplorer((state) => state.setPreferences)

  useEffect(() => {
    void open()
  }, [open])

  const cliLabels = useMemo(
    () => Object.fromEntries((snapshot?.adapters ?? []).map((entry) => [entry.id, entry.label])),
    [snapshot?.adapters]
  )

  if (status === 'unavailable') {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-5 text-sm text-muted-foreground">
        {translate(
          'auto.components.stats.usage.explorer.unavailable',
          'Usage analytics read local logs, so they are only available in the desktop app.'
        )}
      </div>
    )
  }
  if (!snapshot) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/30 px-4 py-5 text-sm text-muted-foreground"
        role="status"
      >
        <Loader2 className="size-4 animate-spin" />
        {translate('auto.components.stats.usage.explorer.loading', 'Reading usage…')}
      </div>
    )
  }

  const { result } = snapshot
  const now = Date.now()
  const hasRows = result.totals.totalTokens > 0
  const idle = snapshot.adapters.filter((adapter) => !adapter.collecting && !adapter.hidden)

  return (
    <div className="space-y-4" data-testid="usage-explorer-pane">
      <section className="space-y-4 rounded-lg border border-border/60 bg-card/30 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">
              {translate(
                'auto.components.stats.usage.explorer.title',
                'Usage across CLIs and hosts'
              )}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground" data-testid="usage-population">
              {translate(
                'auto.components.stats.usage.explorer.populationLine',
                '{{value0}} · days follow {{value1}}',
                { value0: populationLabel(snapshot.population), value1: snapshot.timeZone }
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void syncHosts()}
              disabled={syncing || snapshot.hosts.length === 0}
            >
              {syncing ? <Loader2 className="animate-spin" /> : <Server />}
              {translate('auto.components.stats.usage.explorer.syncHosts', 'Sync hosts')}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void refresh(true)}
                  disabled={refreshing}
                  aria-label={translate(
                    'auto.components.stats.usage.explorer.refreshAria',
                    'Rescan local logs'
                  )}
                >
                  <RefreshCw className={refreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {translate('auto.components.stats.usage.explorer.refreshTip', 'Rescan local logs')}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <UsageExplorerFilters
          filters={filters}
          options={result.options}
          onChange={(patch) => void setFilters(patch)}
          onReset={() => void resetFilters()}
        />

        {error ? (
          <p className="flex items-start gap-1.5 text-xs text-destructive" role="alert">
            <AlertCircle className="mt-0.5 size-3 shrink-0" />
            {error}
          </p>
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          <StatCard
            label={translate('auto.components.stats.usage.explorer.totalTokens', 'Total tokens')}
            value={formatTokens(result.totals.totalTokens)}
            icon={<Sparkles className="size-4" />}
          />
          <StatCard
            label={translate(
              'auto.components.stats.usage.explorer.sessionsRequests',
              'Sessions / requests'
            )}
            value={`${result.totals.sessions.toLocaleString()} / ${result.totals.events.toLocaleString()}`}
            icon={<Layers className="size-4" />}
          />
          <StatCard
            label={translate('auto.components.stats.usage.explorer.activeDays', 'Active days')}
            value={result.activeDays.toLocaleString()}
            icon={<CalendarDays className="size-4" />}
          />
        </div>

        {hasRows ? null : (
          <div className="space-y-3 rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-5">
            <p className="text-sm text-muted-foreground">
              {translate(
                'auto.components.stats.usage.explorer.empty',
                'No usage matches this selection yet.'
              )}
            </p>
            {idle.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {idle.map((adapter) => (
                  <Button
                    key={adapter.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void setCollecting(adapter.id, true)}
                  >
                    {translate(
                      'auto.components.stats.usage.explorer.collectCli',
                      'Collect {{value0}}',
                      {
                        value0: adapter.label
                      }
                    )}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </section>

      {hasRows ? (
        <>
          <UsageCostSection
            totals={result.totals}
            byCli={result.byCli}
            pricing={snapshot.pricing}
          />
          <UsageDailyChart daily={result.daily} totals={result.totals} />
          <UsageBreakdownTabs result={result} />
        </>
      ) : null}

      <UsageHostCoverage
        hosts={snapshot.hosts}
        dedupe={snapshot.dedupe}
        cliLabels={cliLabels}
        now={now}
      />

      <UsageAdapterManager
        adapters={snapshot.adapters}
        unsupportedClis={snapshot.unsupportedClis}
        preferences={snapshot.preferences}
        now={now}
        onSetCollecting={(cli, enabled) => void setCollecting(cli, enabled)}
        onSetPreferences={(preferences) => void setPreferences(preferences)}
      />
    </div>
  )
}
