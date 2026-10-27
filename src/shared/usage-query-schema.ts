import { z } from 'zod'
import { DEFAULT_USAGE_QUERY_FILTERS, type UsageQueryFilters } from './usage-query-types'

const idList = z.array(z.string().min(1).max(512)).max(500).nullable()

const filtersSchema = z.object({
  scope: z.enum(['orca', 'all']),
  range: z.enum(['7d', '30d', '90d', 'all']),
  hostIds: idList,
  clis: idList,
  providers: idList,
  models: idList,
  projectKeys: idList
})

/** Renderer input is untrusted; anything unreadable falls back to the default view. */
export function parseUsageQueryFilters(value: unknown): UsageQueryFilters {
  const parsed = filtersSchema.safeParse(value)
  return parsed.success ? parsed.data : { ...DEFAULT_USAGE_QUERY_FILTERS }
}

const preferencesSchema = z.object({
  excludedClis: z.array(z.string().min(1).max(64)).max(200),
  hiddenClis: z.array(z.string().min(1).max(64)).max(200)
})

export function parseUsagePreferences(value: unknown): z.infer<typeof preferencesSchema> | null {
  const parsed = preferencesSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

const refreshSchema = z.object({
  clis: z.array(z.string().min(1).max(64)).max(200).optional(),
  hostIds: z.array(z.string().min(1).max(512)).max(200).optional(),
  force: z.boolean().optional()
})

export function parseUsageRefreshArgs(value: unknown): z.infer<typeof refreshSchema> {
  const parsed = refreshSchema.safeParse(value ?? {})
  return parsed.success ? parsed.data : {}
}
