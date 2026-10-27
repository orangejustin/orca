import type { UsageProvider } from '../usage/usage-provider-contract'
import { scanTraeUsageFilesViaWorker } from '../usage/usage-scan-worker-spawn'
import type { TraeUsageDailyAggregate, TraeUsagePersistedFile, TraeUsageSession } from './types'

export const TRAE_USAGE_SCHEMA_VERSION = 1

export const traeUsageProvider = {
  id: 'trae',
  label: 'Trae CLI',
  schemaVersion: TRAE_USAGE_SCHEMA_VERSION,
  scan: scanTraeUsageFilesViaWorker
} satisfies UsageProvider<
  'processedFiles',
  TraeUsagePersistedFile,
  TraeUsageSession,
  TraeUsageDailyAggregate
>
