import { describe, expect, it } from 'vitest'
import {
  getUsageModelProviderLabel,
  resolveUsageModelProvider,
  UNKNOWN_USAGE_MODEL_PROVIDER
} from './usage-model-provider'

describe('resolveUsageModelProvider', () => {
  it.each([
    ['claude-sonnet-4-5', 'anthropic'],
    ['gpt-5.4', 'openai'],
    ['o3', 'openai'],
    ['o3-mini', 'openai'],
    ['gemini-2.5-pro', 'google'],
    ['deepseek-v3', 'deepseek'],
    ['kimi-k2', 'moonshot'],
    ['glm-4.6', 'zhipu'],
    ['qwen3-coder', 'alibaba'],
    ['doubao-seed-1.6', 'bytedance']
  ])('classifies %s as %s', (model, provider) => {
    expect(resolveUsageModelProvider(model)).toBe(provider)
  })

  it('reads the maker from a router-style prefix instead of the gateway', () => {
    expect(resolveUsageModelProvider('openrouter/anthropic/claude-sonnet-4')).toBe('anthropic')
    expect(resolveUsageModelProvider('moonshotai/kimi-k2')).toBe('moonshot')
  })

  it('does not classify near-miss names', () => {
    expect(resolveUsageModelProvider('o30')).toBe(UNKNOWN_USAGE_MODEL_PROVIDER)
    expect(resolveUsageModelProvider('gpt')).toBe(UNKNOWN_USAGE_MODEL_PROVIDER)
    expect(resolveUsageModelProvider('my-claude-wrapper')).toBe(UNKNOWN_USAGE_MODEL_PROVIDER)
  })

  it('keeps unknown and missing models unknown', () => {
    expect(resolveUsageModelProvider('some-private-model')).toBe(UNKNOWN_USAGE_MODEL_PROVIDER)
    expect(resolveUsageModelProvider(null)).toBe(UNKNOWN_USAGE_MODEL_PROVIDER)
  })

  it('prefers a provider the log reported over the model name', () => {
    expect(resolveUsageModelProvider('claude-sonnet-4-5', 'Bedrock')).toBe('bedrock')
    expect(resolveUsageModelProvider(null, 'OpenAI')).toBe('openai')
    expect(resolveUsageModelProvider('anything', '  ')).toBe(UNKNOWN_USAGE_MODEL_PROVIDER)
  })
})

describe('getUsageModelProviderLabel', () => {
  it('labels known providers and echoes unfamiliar reported ones', () => {
    expect(getUsageModelProviderLabel('anthropic')).toBe('Anthropic')
    expect(getUsageModelProviderLabel(UNKNOWN_USAGE_MODEL_PROVIDER)).toBe('Unknown provider')
    expect(getUsageModelProviderLabel('bedrock')).toBe('bedrock')
  })
})
