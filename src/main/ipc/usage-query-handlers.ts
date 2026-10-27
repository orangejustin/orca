import { ipcMain } from 'electron'
import {
  parseUsageQueryFilters,
  parseUsagePreferences,
  parseUsageRefreshArgs
} from '../../shared/usage-query-schema'
import type { UsageQueryService } from '../usage/usage-query-service'

export function registerUsageQueryHandlers(service: UsageQueryService): void {
  ipcMain.handle('usage:query', (_event, args: unknown) =>
    service.query(parseUsageQueryFilters(args))
  )
  ipcMain.handle('usage:refresh', (_event, args: unknown) =>
    service.refresh(parseUsageRefreshArgs(args))
  )
  ipcMain.handle('usage:syncHosts', (_event, args: unknown) =>
    service.syncHosts(parseUsageRefreshArgs(args))
  )
  ipcMain.handle('usage:setCollecting', (_event, args: unknown) => {
    const cli = typeof args === 'object' && args !== null && 'cli' in args ? args.cli : null
    const enabled =
      typeof args === 'object' && args !== null && 'enabled' in args ? args.enabled : null
    if (typeof cli !== 'string' || typeof enabled !== 'boolean') {
      throw new Error('usage:setCollecting needs a cli and an enabled flag')
    }
    return service.setCollecting(cli, enabled)
  })
  ipcMain.handle('usage:setPreferences', (_event, args: unknown) => {
    const preferences = parseUsagePreferences(args)
    if (!preferences) {
      throw new Error('usage:setPreferences needs excludedClis and hiddenClis lists')
    }
    return service.setPreferences(preferences)
  })
}
