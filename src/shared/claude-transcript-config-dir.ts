/**
 * Claude writes `<config>/projects/<encoded-cwd>/<sessionId>.jsonl`.
 * String parsing only, so the renderer can use it without Node's path module.
 * Separators are taken from the transcript, not from the machine running the check.
 */
export function claudeConfigDirFromTranscriptPath(
  transcriptPath: string | undefined,
  sessionId: string | undefined
): string | null {
  const transcript = transcriptPath?.trim()
  const id = sessionId?.trim()
  if (!transcript || !id || transcript.includes('\0')) {
    return null
  }
  const slash = transcript.includes('\\') ? '\\' : '/'
  const parts = transcript.split(slash).filter((part, index) => part.length > 0 || index === 0)
  if (parts.at(-1) !== `${id}.jsonl` || parts.length < 4) {
    return null
  }
  const projects = parts.at(-3)
  if (projects !== 'projects') {
    return null
  }
  const rooted = parts[0] === '' || /^[A-Za-z]:$/.test(parts[0] ?? '')
  if (!rooted) {
    return null
  }
  const config = parts.slice(0, -3)
  if (config.length === 0 || (config.length === 1 && config[0] === '')) {
    return null
  }
  return config.join(slash)
}
