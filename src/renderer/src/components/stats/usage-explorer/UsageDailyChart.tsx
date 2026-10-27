import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type {
  UsageQueryDailyPoint,
  UsageQueryTotals
} from '../../../../../shared/usage-query-types'
import { formatTokens } from '../usage-formatters'

const MAX_BARS = 90

type UsageDailyChartProps = {
  daily: UsageQueryDailyPoint[]
  totals: UsageQueryTotals
}

function formatDay(day: string): string {
  const parsed = new Date(`${day}T12:00:00`)
  return Number.isNaN(parsed.getTime())
    ? day
    : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Days with no usage are simply absent from `daily`; the chart shows the days that have some. */
export function UsageDailyChart({ daily, totals }: UsageDailyChartProps): React.JSX.Element {
  const [activeDay, setActiveDay] = useState<UsageQueryDailyPoint | null>(null)
  const days = daily.slice(-MAX_BARS)
  let peak = 1
  for (const day of days) {
    peak = Math.max(peak, day.totalTokens)
  }
  const mix = [
    {
      key: 'fresh',
      label: translate('auto.components.stats.usage.explorer.mixInput', 'New input'),
      value: totals.freshInputTokens,
      swatch: 'bg-foreground'
    },
    {
      key: 'output',
      label: translate('auto.components.stats.usage.explorer.mixOutput', 'Output'),
      value: totals.outputTokens,
      swatch: 'bg-muted-foreground'
    },
    {
      key: 'cache',
      label: translate('auto.components.stats.usage.explorer.mixCache', 'Cache'),
      value: totals.cacheReadTokens + totals.cacheWriteTokens,
      swatch: 'bg-border'
    }
  ]
  const mixTotal = mix.reduce((sum, part) => sum + part.value, 0)

  return (
    <section className="space-y-4 rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">
            {translate('auto.components.stats.usage.explorer.dailyTitle', 'Tokens by day')}
          </h4>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {activeDay
              ? translate(
                  'auto.components.stats.usage.explorer.dailyReadout',
                  '{{value0}}: {{value1}} tokens',
                  {
                    value0: formatDay(activeDay.day),
                    value1: activeDay.totalTokens.toLocaleString()
                  }
                )
              : translate(
                  'auto.components.stats.usage.explorer.dailyHint',
                  'Hover or focus a day to read it.'
                )}
          </p>
        </div>
        {totals.reasoningTokens > 0 ? (
          <Badge variant="outline" className="shrink-0">
            {translate(
              'auto.components.stats.usage.explorer.reasoningBadge',
              '{{value0}} of output is reasoning',
              { value0: formatTokens(totals.reasoningTokens) }
            )}
          </Badge>
        ) : null}
      </div>

      {days.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-border/60 text-xs text-muted-foreground">
          {translate(
            'auto.components.stats.usage.explorer.dailyEmpty',
            'No usage in this selection.'
          )}
        </div>
      ) : (
        <div
          className="flex h-28 items-end gap-px"
          role="group"
          aria-label={translate('auto.components.stats.usage.explorer.dailyTitle', 'Tokens by day')}
          onMouseLeave={() => setActiveDay(null)}
        >
          {days.map((day) => (
            <div
              key={day.day}
              role="img"
              tabIndex={0}
              aria-label={translate(
                'auto.components.stats.usage.explorer.dailyReadout',
                '{{value0}}: {{value1}} tokens',
                { value0: day.day, value1: day.totalTokens.toLocaleString() }
              )}
              className="min-w-px max-w-6 flex-1 rounded-t-[2px] bg-foreground/70 hover:bg-foreground focus-visible:bg-foreground focus-visible:outline-none"
              style={{ height: `${Math.max((day.totalTokens / peak) * 100, 2)}%` }}
              onMouseEnter={() => setActiveDay(day)}
              onFocus={() => setActiveDay(day)}
              onBlur={() => setActiveDay(null)}
            />
          ))}
        </div>
      )}

      <div className="space-y-2">
        {mixTotal > 0 ? (
          <div
            className="flex h-2.5 overflow-hidden rounded-full border border-border/60 bg-muted"
            aria-label={translate('auto.components.stats.usage.explorer.mixTitle', 'Token mix')}
          >
            {mix.map((part) =>
              part.value > 0 ? (
                <div
                  key={part.key}
                  className={part.swatch}
                  style={{ width: `${(part.value / mixTotal) * 100}%` }}
                />
              ) : null
            )}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {mix.map((part) => (
            <span key={part.key} className="inline-flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', part.swatch)} />
              {part.label}: {formatTokens(part.value)}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
