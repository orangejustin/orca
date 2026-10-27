import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

type FilterOption = { key: string; label: string }

type UsageMultiFilterProps = {
  label: string
  options: readonly FilterOption[]
  /** Null means no restriction, which is also what an empty selection collapses to. */
  selected: readonly string[] | null
  onChange: (next: string[] | null) => void
}

function triggerSummary(
  options: readonly FilterOption[],
  selected: readonly string[] | null
): string {
  if (selected === null || selected.length === 0) {
    return translate('auto.components.stats.usage.explorer.filterAll', 'All')
  }
  const first = options.find((option) => option.key === selected[0])?.label ?? selected[0]
  return selected.length === 1
    ? first
    : translate('auto.components.stats.usage.explorer.filterMany', '{{value0}} +{{value1}}', {
        value0: first,
        value1: selected.length - 1
      })
}

export function UsageMultiFilter({
  label,
  options,
  selected,
  onChange
}: UsageMultiFilterProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const chosen = useMemo(() => new Set(selected ?? []), [selected])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle
      ? options.filter((option) => option.label.toLowerCase().includes(needle))
      : options
  }, [options, query])

  const toggle = (key: string): void => {
    const next = new Set(chosen)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    // Choosing everything is the same as choosing nothing in particular.
    onChange(next.size === 0 || next.size === options.length ? null : [...next])
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          setQuery('')
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          className="max-w-56 justify-between"
        >
          <span className="text-muted-foreground">{label}</span>
          <span className="min-w-0 truncate">{triggerSummary(options, selected)}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(300px,calc(100vw-1rem))]">
        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            placeholder={translate('auto.components.stats.usage.explorer.filterSearch', 'Search…')}
            value={query}
            onValueChange={setQuery}
          />
          <div className="border-b border-border">
            <button
              type="button"
              onClick={() => onChange(null)}
              onMouseDown={(event) => event.preventDefault()}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Check
                className={cn('size-3 text-muted-foreground', chosen.size === 0 ? '' : 'opacity-0')}
              />
              {translate('auto.components.stats.usage.explorer.filterAllRow', 'All')}
            </button>
          </div>
          <CommandList>
            <CommandEmpty>
              {translate('auto.components.stats.usage.explorer.filterEmpty', 'Nothing matches.')}
            </CommandEmpty>
            {visible.map((option) => (
              <CommandItem key={option.key} value={option.key} onSelect={() => toggle(option.key)}>
                <Check
                  className={cn(
                    'size-3 text-muted-foreground',
                    chosen.has(option.key) ? '' : 'opacity-0'
                  )}
                />
                <span className="min-w-0 truncate">{option.label}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
