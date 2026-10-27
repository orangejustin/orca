/**
 * Model service provider (who makes the model) as a usage dimension, distinct from the CLI that
 * called it and the model id itself. A log-reported provider always wins; otherwise only
 * unambiguous model-id prefixes classify, and everything else stays `unknown` rather than guessed.
 */

export const UNKNOWN_USAGE_MODEL_PROVIDER = 'unknown'

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  deepseek: 'DeepSeek',
  moonshot: 'Moonshot AI',
  zhipu: 'Zhipu AI',
  alibaba: 'Alibaba',
  bytedance: 'ByteDance',
  xai: 'xAI',
  mistral: 'Mistral',
  [UNKNOWN_USAGE_MODEL_PROVIDER]: 'Unknown provider'
}

const MODEL_PREFIX_PROVIDERS: readonly (readonly [RegExp, string])[] = [
  [/^claude-/, 'anthropic'],
  [/^(gpt-|chatgpt-|codex-|o[134](-|$))/, 'openai'],
  [/^gemini-/, 'google'],
  [/^deepseek-/, 'deepseek'],
  [/^(kimi-|moonshot-)/, 'moonshot'],
  [/^glm-/, 'zhipu'],
  [/^qwen/, 'alibaba'],
  [/^doubao-/, 'bytedance'],
  [/^grok-/, 'xai'],
  [/^(mistral-|codestral)/, 'mistral']
]

// Router/vendor path segments that name the maker rather than the gateway, e.g. `anthropic/claude-x`.
const VENDOR_SLUG_PROVIDERS: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
  deepseek: 'deepseek',
  moonshotai: 'moonshot',
  moonshot: 'moonshot',
  'z-ai': 'zhipu',
  zhipu: 'zhipu',
  qwen: 'alibaba',
  alibaba: 'alibaba',
  bytedance: 'bytedance',
  'x-ai': 'xai',
  xai: 'xai',
  mistralai: 'mistral',
  mistral: 'mistral'
}

function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase()
}

function classifyByModelName(name: string): string | null {
  for (const [pattern, provider] of MODEL_PREFIX_PROVIDERS) {
    if (pattern.test(name)) {
      return provider
    }
  }
  return null
}

export function resolveUsageModelProvider(
  model: string | null,
  reportedProvider?: string | null
): string {
  const reported = reportedProvider ? normalizeProviderId(reportedProvider) : ''
  if (reported) {
    return VENDOR_SLUG_PROVIDERS[reported] ?? reported
  }
  if (!model) {
    return UNKNOWN_USAGE_MODEL_PROVIDER
  }
  const segments = normalizeProviderId(model).split(/[/:]/).filter(Boolean)
  const name = segments.at(-1) ?? ''
  const vendor = segments.length > 1 ? VENDOR_SLUG_PROVIDERS[segments.at(-2) ?? ''] : undefined
  return vendor ?? classifyByModelName(name) ?? UNKNOWN_USAGE_MODEL_PROVIDER
}

export function getUsageModelProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider
}
