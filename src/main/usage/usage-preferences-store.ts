import { existsSync, readFileSync } from 'node:fs'
import { UsageCacheSnapshotWriter } from '../usage-cache-snapshot-writer'
import { DEFAULT_USAGE_PREFERENCES, type UsagePreferences } from '../../shared/usage-service-types'

function normalizeIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))]
    : []
}

/**
 * Which CLIs the user hid or left out of totals. Persisted separately from the scan caches so
 * clearing or rescanning history never changes what the user chose to see.
 */
export class UsagePreferencesStore {
  private preferences: UsagePreferences
  private readonly writer: UsageCacheSnapshotWriter

  constructor(private readonly resolveFile: () => string) {
    this.writer = new UsageCacheSnapshotWriter('[usage-preferences]', resolveFile)
    this.preferences = this.load()
  }

  get(): UsagePreferences {
    return {
      excludedClis: [...this.preferences.excludedClis],
      hiddenClis: [...this.preferences.hiddenClis]
    }
  }

  async set(next: UsagePreferences): Promise<UsagePreferences> {
    this.preferences = {
      excludedClis: normalizeIds(next.excludedClis),
      hiddenClis: normalizeIds(next.hiddenClis)
    }
    await this.writer.write(() => JSON.stringify(this.preferences, null, 2))
    return this.get()
  }

  flush(): Promise<void> {
    return this.writer.flush()
  }

  private load(): UsagePreferences {
    try {
      const file = this.resolveFile()
      if (!existsSync(file)) {
        return { ...DEFAULT_USAGE_PREFERENCES }
      }
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'))
      const record = parsed && typeof parsed === 'object' ? parsed : {}
      return {
        excludedClis: normalizeIds('excludedClis' in record ? record.excludedClis : []),
        hiddenClis: normalizeIds('hiddenClis' in record ? record.hiddenClis : [])
      }
    } catch (error) {
      console.error('[usage-preferences] Failed to load, using defaults:', error)
      return { ...DEFAULT_USAGE_PREFERENCES }
    }
  }
}
