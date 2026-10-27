import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import type {
  UsageQueryBreakdownRow,
  UsageQueryResult
} from '../../../../../shared/usage-query-types'
import { formatCost, formatTokens } from '../usage-formatters'
import { formatShare } from './usage-explorer-copy'

type Dimension = 'byCli' | 'byHost' | 'byProvider' | 'byModel' | 'byProject'

const VISIBLE_ROWS = 25

function dimensionLabel(dimension: Dimension): string {
  switch (dimension) {
    case 'byCli':
      return translate('auto.components.stats.usage.explorer.tabCli', 'CLI')
    case 'byHost':
      return translate('auto.components.stats.usage.explorer.tabHost', 'Host')
    case 'byProvider':
      return translate('auto.components.stats.usage.explorer.tabProvider', 'Provider')
    case 'byModel':
      return translate('auto.components.stats.usage.explorer.tabModel', 'Model')
    case 'byProject':
      return translate('auto.components.stats.usage.explorer.tabProject', 'Project')
  }
}

const DIMENSIONS: Dimension[] = ['byCli', 'byHost', 'byProvider', 'byModel', 'byProject']

function CostCell({ row }: { row: UsageQueryBreakdownRow }): React.JSX.Element {
  if (row.reportedCostUsd === null && row.estimatedCostUsd === null) {
    return (
      <span className="text-muted-foreground">
        {translate('auto.components.stats.usage.explorer.rowNoPrice', 'No price')}
      </span>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {row.estimatedCostUsd !== null ? (
        <span>
          {formatCost(row.estimatedCostUsd)}{' '}
          <span className="text-muted-foreground">
            {translate('auto.components.stats.usage.explorer.rowEstimatedTag', 'est.')}
          </span>
        </span>
      ) : null}
      {row.reportedCostUsd !== null ? (
        <span>
          {formatCost(row.reportedCostUsd)}{' '}
          <span className="text-muted-foreground">
            {translate('auto.components.stats.usage.explorer.rowReportedTag', 'recorded')}
          </span>
        </span>
      ) : null}
      {row.unpricedTokens > 0 ? (
        <Badge variant="outline">
          {translate('auto.components.stats.usage.explorer.rowPartial', 'partly priced')}
        </Badge>
      ) : null}
    </span>
  )
}

export function UsageBreakdownTabs({ result }: { result: UsageQueryResult }): React.JSX.Element {
  const [dimension, setDimension] = useState<Dimension>('byCli')
  const [expanded, setExpanded] = useState(false)
  const rows = result[dimension]
  const shown = expanded ? rows : rows.slice(0, VISIBLE_ROWS)
  const total = result.totals.totalTokens

  return (
    <section className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground">
          {translate('auto.components.stats.usage.explorer.breakdownTitle', 'Breakdown')}
        </h4>
        <Tabs
          value={dimension}
          onValueChange={(value) => {
            const next = DIMENSIONS.find((entry) => entry === value)
            if (next) {
              setDimension(next)
              setExpanded(false)
            }
          }}
        >
          <TabsList>
            {DIMENSIONS.map((entry) => (
              <TabsTrigger key={entry} value={entry}>
                {dimensionLabel(entry)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.components.stats.usage.explorer.breakdownEmpty', 'Nothing to show.')}
        </p>
      ) : (
        <table className="w-full text-xs" data-testid="usage-breakdown-table">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pb-1.5 font-medium">{dimensionLabel(dimension)}</th>
              <th className="pb-1.5 text-right font-medium">
                {translate('auto.components.stats.usage.explorer.colTokens', 'Tokens')}
              </th>
              <th className="pb-1.5 text-right font-medium">
                {translate('auto.components.stats.usage.explorer.colShare', 'Share')}
              </th>
              <th className="pb-1.5 text-right font-medium">
                {translate('auto.components.stats.usage.explorer.colEvents', 'Requests')}
              </th>
              <th className="pb-1.5 text-right font-medium">
                {translate('auto.components.stats.usage.explorer.colCost', 'Cost')}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.key} className="border-t border-border/40">
                <td className="max-w-64 truncate py-1.5 pr-3 text-foreground">{row.label}</td>
                <td className="py-1.5 text-right tabular-nums">{formatTokens(row.totalTokens)}</td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {formatShare(total > 0 ? row.totalTokens / total : null)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {row.events.toLocaleString()}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  <CostCell row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > VISIBLE_ROWS ? (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? translate('auto.components.stats.usage.explorer.showFewer', 'Show fewer')
            : translate('auto.components.stats.usage.explorer.showAll', 'Show all {{value0}}', {
                value0: rows.length
              })}
        </button>
      ) : null}
    </section>
  )
}
