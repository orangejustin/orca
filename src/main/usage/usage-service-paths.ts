import { app } from 'electron'
import { join } from 'node:path'
import { initRegisteredUsageAdapterPaths } from './usage-adapter-registry'

// Why: capture the paths after configureDevUserDataPath() but before app.setName() changes
// Electron's derived userData location, as the per-CLI usage caches do.
let preferencesFile: string | null = null
let hostCacheFile: string | null = null

export function initUsageServicePaths(): void {
  const userData = app.getPath('userData')
  preferencesFile = join(userData, 'orca-usage-preferences.json')
  hostCacheFile = join(userData, 'orca-usage-hosts.json')
  initRegisteredUsageAdapterPaths()
}

export function getUsagePreferencesFile(): string {
  preferencesFile ??= join(app.getPath('userData'), 'orca-usage-preferences.json')
  return preferencesFile
}

export function getUsageHostCacheFile(): string {
  hostCacheFile ??= join(app.getPath('userData'), 'orca-usage-hosts.json')
  return hostCacheFile
}
