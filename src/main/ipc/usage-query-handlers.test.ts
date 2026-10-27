import { describe, expect, it, vi } from 'vitest'

const { handle } = vi.hoisted(() => ({ handle: vi.fn() }))

vi.mock('electron', () => ({ ipcMain: { handle } }))

import { DEFAULT_USAGE_QUERY_FILTERS } from '../../shared/usage-query-types'
import { UsagePreferencesStore } from '../usage/usage-preferences-store'
import { UsageQueryService } from '../usage/usage-query-service'
import { registerUsageQueryHandlers } from './usage-query-handlers'

function makeService() {
  const service = new UsageQueryService({
    getStores: () => new Map(),
    preferences: new UsagePreferencesStore(() => '/nonexistent/orca-usage-preferences.json'),
    hosts: null,
    appVersion: '1.0.0',
    timeZone: () => 'UTC',
    localHostLabel: 'This computer',
    launchableClis: {}
  })
  return {
    service,
    query: vi.spyOn(service, 'query'),
    refresh: vi.spyOn(service, 'refresh').mockResolvedValue(),
    setCollecting: vi.spyOn(service, 'setCollecting').mockResolvedValue(),
    setPreferences: vi.spyOn(service, 'setPreferences').mockResolvedValue({
      excludedClis: [],
      hiddenClis: []
    })
  }
}

function call(channel: string, args?: unknown): unknown {
  const registration = handle.mock.calls.find(([name]) => name === channel)
  return registration?.[1]({}, args)
}

describe('usage query IPC handlers', () => {
  it('registers one route per service action', () => {
    handle.mockClear()
    registerUsageQueryHandlers(makeService().service)
    expect(handle.mock.calls.map(([channel]) => channel).sort()).toEqual([
      'usage:query',
      'usage:refresh',
      'usage:setCollecting',
      'usage:setPreferences',
      'usage:syncHosts'
    ])
  })

  it('passes validated filters to the service and falls back to the default view for junk', () => {
    handle.mockClear()
    const { service, query } = makeService()
    registerUsageQueryHandlers(service)

    call('usage:query', { ...DEFAULT_USAGE_QUERY_FILTERS, hostIds: ['ssh:cloud'] })
    expect(query).toHaveBeenLastCalledWith({
      ...DEFAULT_USAGE_QUERY_FILTERS,
      hostIds: ['ssh:cloud']
    })

    call('usage:query', { scope: 'everything', range: 'forever' })
    expect(query).toHaveBeenLastCalledWith(DEFAULT_USAGE_QUERY_FILTERS)
    call('usage:query', null)
    expect(query).toHaveBeenLastCalledWith(DEFAULT_USAGE_QUERY_FILTERS)
  })

  it('refreshes only what was asked for and drops malformed arguments', () => {
    handle.mockClear()
    const { service, refresh } = makeService()
    registerUsageQueryHandlers(service)

    call('usage:refresh', { clis: ['claude'], hostIds: ['ssh:cloud'], force: true })
    expect(refresh).toHaveBeenLastCalledWith({
      clis: ['claude'],
      hostIds: ['ssh:cloud'],
      force: true
    })
    call('usage:refresh', { clis: 'claude' })
    expect(refresh).toHaveBeenLastCalledWith({})
  })

  it('rejects a collection toggle or preferences update it cannot read', () => {
    handle.mockClear()
    const { service, setCollecting, setPreferences } = makeService()
    registerUsageQueryHandlers(service)

    expect(() => call('usage:setCollecting', { cli: 'trae' })).toThrow(/enabled/)
    expect(() => call('usage:setPreferences', { excludedClis: 'trae' })).toThrow(/lists/)
    expect(setCollecting).not.toHaveBeenCalled()
    expect(setPreferences).not.toHaveBeenCalled()

    call('usage:setCollecting', { cli: 'trae', enabled: false })
    expect(setCollecting).toHaveBeenCalledWith('trae', false)
    call('usage:setPreferences', { excludedClis: ['trae'], hiddenClis: [] })
    expect(setPreferences).toHaveBeenCalledWith({ excludedClis: ['trae'], hiddenClis: [] })
  })
})
