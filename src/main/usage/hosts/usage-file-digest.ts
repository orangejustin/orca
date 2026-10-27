import { createHash } from 'node:crypto'

const digestByKeys = new WeakMap<readonly string[], string | null>()

/**
 * Content identity of a log file: a hash of the event keys it owns. A copy of the same log on
 * another machine hashes the same whatever its path, host or file times, which is what lets copied
 * history count once. Null for a file that owns nothing, so empty files never match each other.
 */
export function usageFileDigest(ownedKeys: readonly string[]): string | null {
  if (ownedKeys.length === 0) {
    return null
  }
  const cached = digestByKeys.get(ownedKeys)
  if (cached !== undefined) {
    return cached
  }
  const hash = createHash('sha1')
  for (const key of [...ownedKeys].sort()) {
    hash.update(key)
    hash.update('\n')
  }
  const digest = hash.digest('hex')
  digestByKeys.set(ownedKeys, digest)
  return digest
}
