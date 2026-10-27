import { app } from 'electron'
import { join } from 'node:path'
import type { Store } from '../persistence'
import { UsageProviderStoreLifecycle } from '../usage/usage-provider-store-lifecycle'
import { getDefaultTraeUsageState, normalizeTraeUsageState } from './persisted-state-normalization'
import { TRAE_USAGE_CLI, traeUsageRows, traeUsageSessionRefs } from './trae-usage-rows'
import { traeUsageProvider } from './trae-usage-provider'
import type { TraeUsagePersistedState } from './types'

let traeUsageFile: string | null = null

export function initTraeUsagePath(): void {
  traeUsageFile = join(app.getPath('userData'), 'orca-trae-usage.json')
}

function getTraeUsageFile(): string {
  traeUsageFile ??= join(app.getPath('userData'), 'orca-trae-usage.json')
  return traeUsageFile
}

export class TraeUsageStore extends UsageProviderStoreLifecycle<
  'processedFiles',
  TraeUsagePersistedState,
  'hasAnyTraeData'
> {
  constructor(store: Pick<Store, 'getRepos' | 'getAllWorktreeMeta'>) {
    super(store, {
      logTag: '[trae-usage]',
      cli: TRAE_USAGE_CLI,
      files: (state) =>
        state.processedFiles.map((file) => ({
          ownedKeys: file.ownedEventKeys,
          slice: { sessions: file.sessions, dailyAggregates: file.dailyAggregates }
        })),
      unify: (state, hostId) => ({
        rows: traeUsageRows(state.dailyAggregates, hostId),
        sessions: traeUsageSessionRefs(state.sessions, hostId)
      }),
      resolveCacheFile: getTraeUsageFile,
      createDefaultState: getDefaultTraeUsageState,
      normalizeState: normalizeTraeUsageState,
      sourceKey: 'processedFiles',
      dataPresenceKey: 'hasAnyTraeData',
      scan: traeUsageProvider.scan
    })
  }
}
