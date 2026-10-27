import { homedir } from 'node:os'
import { join } from 'node:path'
import { readdir } from 'node:fs/promises'

/**
 * Claude Code keeps transcripts under its config dir, which `CLAUDE_CONFIG_DIR` relocates. The
 * default `~/.claude` stays listed too, so history written before the override is still read.
 */
export function resolveClaudeTranscriptRoots(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir()
): string[] {
  const configDirs = [env.CLAUDE_CONFIG_DIR?.trim(), join(home, '.claude')].filter(
    (dir): dir is string => Boolean(dir)
  )
  return [...new Set(configDirs)].flatMap((dir) => [
    join(dir, 'projects'),
    join(dir, 'transcripts')
  ])
}

async function walkJsonlFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      appendDiscoveredFiles(files, await walkJsonlFiles(fullPath))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(fullPath)
    }
  }

  return files
}

function appendDiscoveredFiles(target: string[], source: readonly string[]): void {
  // Why: long-lived transcript directories can exceed V8's argument limit if
  // child file arrays are spread into push().
  for (const filePath of source) {
    target.push(filePath)
  }
}

export async function listClaudeTranscriptFiles(): Promise<string[]> {
  const roots = resolveClaudeTranscriptRoots()
  const files = await Promise.all(
    roots.map(async (root) => {
      try {
        return await walkJsonlFiles(root)
      } catch {
        return []
      }
    })
  )
  return [...new Set(files.flat())].sort()
}
