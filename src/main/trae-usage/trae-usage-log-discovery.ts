import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

// Why: the new Trae CLI storage layout is not documented, so logs are found by content under
// known roots instead of by an assumed subdirectory structure.
const MAX_DEPTH = 6
const MAX_LOG_FILES = 50_000
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'skills', 'extensions', 'cache'])
export const TRAE_USAGE_ROOTS_ENV = 'ORCA_TRAE_USAGE_ROOTS'

export function resolveTraeUsageRoots(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir()
): string[] {
  const override = env[TRAE_USAGE_ROOTS_ENV]?.split(delimiter).filter(Boolean)
  if (override && override.length > 0) {
    return override
  }
  return [
    join(home, '.trae-cn'),
    join(home, '.trae'),
    // The 1.0 CLI (coco) kept sessions here; the new CLI migrates them.
    join(env.XDG_CACHE_HOME || join(home, '.cache'), 'coco', 'sessions')
  ]
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function collectJsonlFiles(
  directory: string,
  depth: number,
  files: string[],
  isRoot: boolean
): Promise<void> {
  if (depth > MAX_DEPTH || files.length >= MAX_LOG_FILES) {
    return
  }
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    // A missing root means "no Trae data"; any other root failure must reach lastScanError.
    if (isRoot && !isMissingPathError(error)) {
      throw error
    }
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        await collectJsonlFiles(join(directory, entry.name), depth + 1, files, false)
      }
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(join(directory, entry.name))
    }
  }
}

/** Lists candidate `.jsonl` logs under the roots, sorted so event ownership is deterministic. */
export async function listTraeUsageLogFiles(roots = resolveTraeUsageRoots()): Promise<string[]> {
  const files: string[] = []
  for (const root of roots) {
    await collectJsonlFiles(root, 0, files, true)
  }
  return [...new Set(files)].sort((left, right) => left.localeCompare(right))
}
