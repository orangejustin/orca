import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import {
  DEFAULT_USAGE_QUERY_FILTERS,
  type UsageQueryFilters,
  type UsageQueryOptions,
  type UsageQueryRange,
  type UsageQueryScope
} from '../../../../../shared/usage-query-types'
import { UsageMultiFilter } from './UsageMultiFilter'

type UsageExplorerFiltersProps = {
  filters: UsageQueryFilters
  options: UsageQueryOptions
  onChange: (patch: Partial<UsageQueryFilters>) => void
  onReset: () => void
}

const RANGES: UsageQueryRange[] = ['7d', '30d', '90d', 'all']

function rangeLabel(range: UsageQueryRange): string {
  switch (range) {
    case '7d':
      return translate('auto.components.stats.usage.explorer.range7', '7 days')
    case '30d':
      return translate('auto.components.stats.usage.explorer.range30', '30 days')
    case '90d':
      return translate('auto.components.stats.usage.explorer.range90', '90 days')
    case 'all':
      return translate('auto.components.stats.usage.explorer.rangeAll', 'All time')
  }
}

function isDefault(filters: UsageQueryFilters): boolean {
  return JSON.stringify(filters) === JSON.stringify(DEFAULT_USAGE_QUERY_FILTERS)
}

export function UsageExplorerFilters({
  filters,
  options,
  onChange,
  onReset
}: UsageExplorerFiltersProps): React.JSX.Element {
  return (
    <div className="space-y-3" data-testid="usage-explorer-filters">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filters.scope}
          aria-label={translate(
            'auto.components.stats.usage.explorer.scopeLabel',
            'Which sessions'
          )}
          onValueChange={(value) => {
            if (value === 'orca' || value === 'all') {
              onChange({ scope: value satisfies UsageQueryScope })
            }
          }}
        >
          <ToggleGroupItem value="orca">
            {translate('auto.components.stats.usage.explorer.scopeOrca', 'Orca worktrees')}
          </ToggleGroupItem>
          <ToggleGroupItem value="all">
            {translate('auto.components.stats.usage.explorer.scopeAll', 'All readable history')}
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filters.range}
          aria-label={translate('auto.components.stats.usage.explorer.rangeLabel', 'Date range')}
          onValueChange={(value) => {
            const next = RANGES.find((range) => range === value)
            if (next) {
              onChange({ range: next })
            }
          }}
        >
          {RANGES.map((range) => (
            <ToggleGroupItem key={range} value={range}>
              {rangeLabel(range)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {isDefault(filters) ? null : (
          <Button type="button" variant="ghost" size="xs" onClick={onReset}>
            <RotateCcw />
            {translate('auto.components.stats.usage.explorer.resetFilters', 'Reset')}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <UsageMultiFilter
          label={translate('auto.components.stats.usage.explorer.filterHost', 'Host')}
          options={options.hosts}
          selected={filters.hostIds}
          onChange={(hostIds) => onChange({ hostIds })}
        />
        <UsageMultiFilter
          label={translate('auto.components.stats.usage.explorer.filterCli', 'CLI')}
          options={options.clis}
          selected={filters.clis}
          onChange={(clis) => onChange({ clis })}
        />
        <UsageMultiFilter
          label={translate('auto.components.stats.usage.explorer.filterProvider', 'Provider')}
          options={options.providers}
          selected={filters.providers}
          onChange={(providers) => onChange({ providers })}
        />
        <UsageMultiFilter
          label={translate('auto.components.stats.usage.explorer.filterModel', 'Model')}
          options={options.models}
          selected={filters.models}
          onChange={(models) => onChange({ models })}
        />
        <UsageMultiFilter
          label={translate('auto.components.stats.usage.explorer.filterProject', 'Project')}
          options={options.projects}
          selected={filters.projectKeys}
          onChange={(projectKeys) => onChange({ projectKeys })}
        />
      </div>
    </div>
  )
}
