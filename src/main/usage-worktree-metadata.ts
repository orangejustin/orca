import { basename } from 'node:path'
import type { Repo } from '../shared/repo-types'
import { splitWorktreeId, splitWorktreeIdForFilesystem } from '../shared/worktree/id'
import { isFolderRepo } from '../shared/repo-kind'
import type { Store } from './persistence'

export type UsageWorktreeRef = {
  worktreeId: string
  path: string
  displayName: string
}

function getDefaultUsageWorktreeLabel(pathValue: string): string {
  return basename(pathValue)
}

/**
 * @param connectionId the SSH target whose repos to load; null loads the local ones, as before.
 *   A remote host is scanned on that host, so its worktrees are the ones registered under it.
 */
export function loadKnownUsageWorktreesByRepo(
  store: Pick<Store, 'getAllWorktreeMeta'>,
  repos: Repo[],
  connectionId: string | null = null
): Map<string, UsageWorktreeRef[]> {
  const localRepos = repos.filter((repo) => (repo.connectionId ?? null) === connectionId)
  // Why: all three usage scanners revisit persisted worktree metadata; index
  // repos once instead of linearly searching the full list for every row.
  const localReposById = new Map<string, Repo>()
  for (const repo of localRepos) {
    const repoId = repo.id
    // Preserve the former Array.find behavior if corrupt state repeats an ID.
    if (!localReposById.has(repoId)) {
      localReposById.set(repoId, repo)
    }
  }
  const worktreesByRepo = new Map<string, UsageWorktreeRef[]>()
  const seenPathsByRepo = new Map<string, Set<string>>()

  for (const repo of localRepos) {
    worktreesByRepo.set(repo.id, [
      {
        worktreeId: `${repo.id}::${repo.path}`,
        path: repo.path,
        displayName: repo.displayName || getDefaultUsageWorktreeLabel(repo.path)
      }
    ])
    seenPathsByRepo.set(repo.id, new Set([repo.path]))
  }

  // Why: usage scans are background/opt-in analytics. Do not spawn
  // `git worktree list` here; it can re-touch macOS protected folders.
  for (const [worktreeId, meta] of Object.entries(store.getAllWorktreeMeta())) {
    const parsed = splitWorktreeId(worktreeId)
    if (!parsed) {
      continue
    }
    const repo = localReposById.get(parsed.repoId)
    if (!repo) {
      continue
    }
    const worktreePath = isFolderRepo(repo)
      ? (splitWorktreeIdForFilesystem(worktreeId)?.worktreePath ?? parsed.worktreePath)
      : parsed.worktreePath
    const seenPaths = seenPathsByRepo.get(parsed.repoId)
    if (seenPaths?.has(worktreePath)) {
      continue
    }
    seenPaths?.add(worktreePath)
    worktreesByRepo.get(parsed.repoId)?.push({
      worktreeId,
      path: worktreePath,
      displayName: meta.displayName || getDefaultUsageWorktreeLabel(worktreePath)
    })
  }

  return worktreesByRepo
}
