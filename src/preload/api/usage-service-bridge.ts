import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const usageServiceApi = {
  query: (filters) => ipcRenderer.invoke('usage:query', filters),
  refresh: (args) => ipcRenderer.invoke('usage:refresh', args),
  syncHosts: (args) => ipcRenderer.invoke('usage:syncHosts', args),
  setCollecting: (args) => ipcRenderer.invoke('usage:setCollecting', args),
  setPreferences: (preferences) => ipcRenderer.invoke('usage:setPreferences', preferences)
} satisfies PreloadApi['usage']
