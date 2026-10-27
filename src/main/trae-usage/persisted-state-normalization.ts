import { TRAE_USAGE_SCHEMA_VERSION } from './trae-usage-provider'
import type { TraeUsagePersistedState } from './types'

export function getDefaultTraeUsageState(): TraeUsagePersistedState {
  return {
    schemaVersion: TRAE_USAGE_SCHEMA_VERSION,
    worktreeFingerprint: null,
    processedFiles: [],
    sessions: [],
    dailyAggregates: [],
    scanState: {
      enabled: false,
      lastScanStartedAt: null,
      lastScanCompletedAt: null,
      lastScanError: null
    }
  }
}

export function normalizeTraeUsageState(state: TraeUsagePersistedState): TraeUsagePersistedState {
  // Why: a cache from another schema cannot be trusted; rescan but keep the opt-in.
  if (state.schemaVersion !== TRAE_USAGE_SCHEMA_VERSION) {
    const defaults = getDefaultTraeUsageState()
    return {
      ...defaults,
      scanState: { ...defaults.scanState, enabled: state.scanState?.enabled ?? false }
    }
  }
  return {
    ...state,
    processedFiles: (state.processedFiles ?? []).map((file) => ({
      ...file,
      sessions: file.sessions ?? [],
      dailyAggregates: file.dailyAggregates ?? [],
      ownedEventKeys: file.ownedEventKeys ?? [],
      hasDeferredClaims: file.hasDeferredClaims ?? true
    })),
    sessions: state.sessions ?? [],
    dailyAggregates: state.dailyAggregates ?? []
  }
}
