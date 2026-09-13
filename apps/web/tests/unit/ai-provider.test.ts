import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  aiProviderConfiguration,
  aiProviderJsonSchema,
  aiProviderModel,
  aiProviderStructuredRouting,
  aiProviderWebSearch,
} from '../../server/utils/ai-provider'

afterEach(() => vi.unstubAllEnvs())

describe('AI provider configuration', () => {
  it('removes unsupported string formats while preserving structural validation', () => {
    const schema = aiProviderJsonSchema({
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri', minLength: 1 },
        ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
      },
      required: ['url', 'ids'],
      additionalProperties: false,
    })
    expect(schema).toEqual({
      type: 'object',
      properties: {
        url: { type: 'string', minLength: 1 },
        ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['url', 'ids'],
      additionalProperties: false,
    })
  })

  it('defaults to the direct OpenAI Responses API', () => {
    vi.stubEnv('AI_PROVIDER', '')
    vi.stubEnv('OPENAI_API_KEY', 'openai-fixture')
    vi.stubEnv('AI_PLANNER_MODEL', 'gpt-5.6-terra')
    const provider = aiProviderConfiguration()
    expect(provider).toMatchObject({
      name: 'openai',
      responsesUrl: 'https://api.openai.com/v1/responses',
      imagesUrl: 'https://api.openai.com/v1/images/edits',
    })
    expect(provider.headers.Authorization).toBe('Bearer openai-fixture')
    expect(provider.headers['HTTP-Referer']).toBeUndefined()
    expect(aiProviderModel('AI_PLANNER_MODEL')).toBe('gpt-5.6-terra')
  })

  it('uses the OpenRouter endpoint, credential, model prefix and attribution', () => {
    vi.stubEnv('AI_PROVIDER', 'openrouter')
    vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-fixture')
    vi.stubEnv('AI_PLANNER_MODEL', 'gpt-5.6-terra')
    vi.stubEnv('OPENROUTER_SITE_URL', 'https://rrit.example/app')
    vi.stubEnv('OPENROUTER_APP_NAME', 'Rrit Test')
    const provider = aiProviderConfiguration()
    expect(provider).toMatchObject({
      name: 'openrouter',
      responsesUrl: 'https://openrouter.ai/api/v1/responses',
      imagesUrl: 'https://openrouter.ai/api/v1/images',
    })
    expect(provider.headers).toMatchObject({
      Authorization: 'Bearer openrouter-fixture',
      'HTTP-Referer': 'https://rrit.example/app',
      'X-OpenRouter-Title': 'Rrit Test',
    })
    expect(aiProviderModel('AI_PLANNER_MODEL')).toBe('openai/gpt-5.6-terra')
    expect(aiProviderStructuredRouting(provider.name)).toEqual({
      provider: { require_parameters: true },
    })
    expect(aiProviderWebSearch(provider.name, 3)).toMatchObject({
      tools: [{ type: 'openrouter:web_search', parameters: { max_uses: 3 } }],
      max_tool_calls: 3,
    })
  })

  it('fails closed for a missing selected credential or invalid provider', () => {
    vi.stubEnv('AI_PROVIDER', 'openrouter')
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', 'wrong-provider-fixture')
    expect(() => aiProviderConfiguration()).toThrow('AI provider key is not configured')
    vi.stubEnv('AI_PROVIDER', 'unknown')
    expect(() => aiProviderConfiguration()).toThrow('AI_PROVIDER must be openai or openrouter')
  })
})
