import { app } from 'electron'
import { getLocalExecutionHostLabel, isRuntimeOwnedSshTargetId } from '../../shared/execution-host'
import { TUI_AGENT_DISPLAY_NAMES } from '../../shared/tui-agent-display-names'
import type { Store } from '../persistence'
import { getActiveMultiplexer, listRegisteredSshTargets } from '../ssh/ssh-target-registry'
import { isSshRequestOutcomeUnverifiable } from '../ssh/ssh-channel-multiplexer'
import { isMethodNotFoundError } from '../ssh/ssh-filesystem-stream-reader'
import { loadKnownUsageWorktreesByRepo } from '../usage-worktree-metadata'
import { RemoteUsageCache } from './hosts/remote-usage-cache'
import { UsageHostCoordinator } from './hosts/usage-host-coordinator'
import type { UsageAdapterStore } from './usage-adapter-registry'
import { UsagePreferencesStore } from './usage-preferences-store'
import { UsageQueryService } from './usage-query-service'
import { getUsageHostCacheFile, getUsagePreferencesFile } from './usage-service-paths'
import { createWorktreeRefs } from './usage-worktree-refs'

type UsageServiceStore = Pick<Store, 'getRepos' | 'getAllWorktreeMeta'>

/** Wires the usage service to this app's stores, SSH layer and settings. */
export function createUsageQueryService(
  store: UsageServiceStore,
  stores: ReadonlyMap<string, UsageAdapterStore>
): { service: UsageQueryService; hosts: UsageHostCoordinator } {
  const hosts = new UsageHostCoordinator({
    cache: new RemoteUsageCache(getUsageHostCacheFile),
    listTargets: () =>
      listRegisteredSshTargets()
        .filter((target) => !isRuntimeOwnedSshTargetId(target.id))
        .map((target) => ({ id: target.id, label: target.label })),
    getMux: (targetId) => getActiveMultiplexer(targetId),
    getHostWorktrees: (targetId) => {
      const repos = store.getRepos().filter((repo) => repo.connectionId === targetId)
      return createWorktreeRefs(repos, loadKnownUsageWorktreesByRepo(store, repos, targetId))
    },
    getStores: () => stores,
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    now: () => Date.now(),
    isMethodNotFound: isMethodNotFoundError,
    isOutcomeUnverifiable: isSshRequestOutcomeUnverifiable
  })
  const service = new UsageQueryService({
    getStores: () => stores,
    preferences: new UsagePreferencesStore(getUsagePreferencesFile),
    hosts,
    appVersion: app.getVersion(),
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    localHostLabel: getLocalExecutionHostLabel(),
    launchableClis: TUI_AGENT_DISPLAY_NAMES
  })
  return { service, hosts }
}
