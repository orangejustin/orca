import { translate } from '@/i18n/i18n'
import type {
  UsageQueryBreakdownRow,
  UsageQueryTotals
} from '../../../../../shared/usage-query-types'
import type { UsagePricingInfo } from '../../../../../shared/usage-service-types'
import { formatTokens } from '../usage-formatters'
import { costBasisLabel, formatShare, summarizeCost } from './usage-explorer-copy'

type UsageCostSectionProps = {
  totals: UsageQueryTotals
  byCli: UsageQueryBreakdownRow[]
  pricing: UsagePricingInfo[]
}

/**
 * Cost, with where each figure came from. A cost the CLI wrote to its log, an estimate from
 * Orca's price table, and tokens with no price are different things and are not added together.
 */
export function UsageCostSection({
  totals,
  byCli,
  pricing
}: UsageCostSectionProps): React.JSX.Element {
  const cost = summarizeCost(totals)
  const shownClis = new Set(byCli.map((row) => row.key))
  const sources = pricing.filter((entry) => shownClis.has(entry.cli))
  const noDollarFigure = cost.reported === null && cost.estimated === null

  return (
    <section
      className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4"
      aria-label={translate('auto.components.stats.usage.explorer.costTitle', 'Cost')}
    >
      <div>
        <h4 className="text-sm font-semibold text-foreground">
          {translate('auto.components.stats.usage.explorer.costTitle', 'Cost')}
        </h4>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.stats.usage.explorer.costCaveat',
            'What these tokens would cost at API prices, not what you are billed. Plan rate limits are not part of these totals.'
          )}
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">
            {translate(
              'auto.components.stats.usage.explorer.costEstimated',
              'API-equivalent estimate'
            )}
          </dt>
          <dd className="text-lg font-semibold text-foreground" data-testid="usage-cost-estimated">
            {cost.estimated ?? translate('auto.components.stats.usage.explorer.costNone', 'n/a')}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {translate('auto.components.stats.usage.explorer.costReported', 'Recorded by the CLI')}
          </dt>
          <dd className="text-lg font-semibold text-foreground" data-testid="usage-cost-reported">
            {cost.reported ?? translate('auto.components.stats.usage.explorer.costNone', 'n/a')}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {translate('auto.components.stats.usage.explorer.costUnpriced', 'Tokens with no price')}
          </dt>
          <dd className="text-lg font-semibold text-foreground" data-testid="usage-cost-unpriced">
            {formatTokens(cost.unpricedTokens)}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        {noDollarFigure && cost.unpricedTokens > 0
          ? translate(
              'auto.components.stats.usage.explorer.costAllUnpriced',
              'None of these tokens has a price, so no dollar figure is shown. That is not zero cost.'
            )
          : translate(
              'auto.components.stats.usage.explorer.costCoverage',
              '{{value0}} of tokens are priced. Dollar figures leave the rest out.',
              { value0: formatShare(cost.pricedShare) }
            )}
      </p>
      {sources.length > 0 ? (
        <ul className="space-y-1 text-xs text-muted-foreground" data-testid="usage-cost-sources">
          {sources.map((entry) => (
            <li key={entry.cli}>
              <span className="text-foreground">{entry.label}</span>
              {': '}
              {costBasisLabel(entry.basis)}
              {entry.source ? ` · ${entry.source}` : ''}
              {entry.basis === 'estimated'
                ? ` · ${translate(
                    'auto.components.stats.usage.explorer.costTableVersion',
                    'price table in Orca {{value0}}',
                    { value0: entry.tableVersion }
                  )}`
                : ''}
              {entry.pricedTokenShare !== null
                ? ` · ${translate(
                    'auto.components.stats.usage.explorer.costPricedShare',
                    '{{value0}} priced',
                    { value0: formatShare(entry.pricedTokenShare) }
                  )}`
                : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
