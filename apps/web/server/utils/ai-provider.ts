import { createHash } from 'node:crypto'
export type AiProviderName = 'openai' | 'openrouter'

export type AiProviderConfiguration = {
  name: AiProviderName
  apiKey: string
  keyFingerprint: string
  responsesUrl: string
  imagesUrl: string
  headers: Record<string, string>
}

function providerName(): AiProviderName {
  const value = (process.env.AI_PROVIDER || 'openai').trim().toLowerCase()
  if (value !== 'openai' && value !== 'openrouter')
    throw new Error('AI_PROVIDER must be openai or openrouter')
  return value
}

function safeHeader(value: string | undefined, maximum: number) {
  const result = value?.trim()
  if (!result) return undefined
  if (result.length > maximum || /[\r\n]/.test(result))
    throw new Error('AI provider header configuration is invalid')
  return result
}

function safeReferer(value: string | undefined) {
  const result = safeHeader(value, 2048)
  if (!result) return undefined
  const url = new URL(result)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('OPENROUTER_SITE_URL must be an HTTP(S) URL without credentials')
  return url.toString()
}

/**
 * Identifies which API key made a call without storing the key: a truncated
 * SHA-256. Calls from other environments sharing the database (another key)
 * get a different fingerprint.
 */
export function providerKeyFingerprint(apiKey: string) {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16)
}

/** The provider's real charge in micro-EUR, or null when it reported none. */
export function providerCostMicroEur(costUsd: unknown, usdMicroEur: number) {
  if (typeof costUsd !== 'number' || !Number.isFinite(costUsd) || costUsd < 0) return null
  if (!Number.isSafeInteger(usdMicroEur) || usdMicroEur <= 0) return null
  return Math.ceil(costUsd * usdMicroEur)
}

export function aiProviderConfiguration(): AiProviderConfiguration {
  const name = providerName()
  const apiKey = (
    name === 'openrouter' ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY
  )?.trim()
  if (!apiKey || apiKey === 'EMPTY') throw new Error('AI provider key is not configured')

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  if (name === 'openrouter') {
    const referer = safeReferer(process.env.OPENROUTER_SITE_URL || process.env.APP_URL)
    const title = safeHeader(process.env.OPENROUTER_APP_NAME || 'Rrit', 256)
    if (referer) headers['HTTP-Referer'] = referer
    if (title) headers['X-OpenRouter-Title'] = title
  }

  return {
    name,
    apiKey,
    keyFingerprint: providerKeyFingerprint(apiKey),
    responsesUrl:
      name === 'openrouter'
        ? 'https://openrouter.ai/api/v1/responses'
        : 'https://api.openai.com/v1/responses',
    imagesUrl:
      name === 'openrouter'
        ? 'https://openrouter.ai/api/v1/images'
        : 'https://api.openai.com/v1/images/edits',
    headers,
  }
}

export function aiProviderConfigured() {
  try {
    aiProviderConfiguration()
    return true
  } catch {
    return false
  }
}

export function aiProviderModel(variable: 'OPENAI_MODEL' | 'AI_PLANNER_MODEL' | 'AI_IMAGE_MODEL') {
  const model = process.env[variable]?.trim()
  if (!model) throw new Error(`${variable} is not configured`)
  if (providerName() === 'openrouter' && !model.includes('/')) return `openai/${model}`
  return model
}

export function aiProviderModelConfigured(
  variable: 'OPENAI_MODEL' | 'AI_PLANNER_MODEL' | 'AI_IMAGE_MODEL',
) {
  try {
    aiProviderModel(variable)
    return true
  } catch {
    return false
  }
}

export function aiProviderStructuredRouting(provider: AiProviderName) {
  return provider === 'openrouter' ? { provider: { require_parameters: true } } : {}
}

// Provider-enforced JSON Schema supports a narrower set of string formats than
// Zod. Domain schemas are parsed again after the response, so removing an
// unsupported format does not remove URL/UUID/date validation from the app.
export function aiProviderJsonSchema(value: unknown): Record<string, unknown> {
  function normalize(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(normalize)
    if (!node || typeof node !== 'object') return node
    return Object.fromEntries(
      Object.entries(node)
        // Provider-side structured output supports only a subset of JSON
        // Schema regex syntax. Domain schemas are parsed again after the
        // response, so formats and patterns remain enforced by Zod locally.
        .filter(([key]) => !['format', 'pattern'].includes(key))
        .map(([key, item]) => [key, normalize(item)]),
    )
  }
  const normalized = normalize(value)
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized))
    throw new Error('AI JSON schema must be an object')
  return normalized as Record<string, unknown>
}

export function aiProviderWebSearch(provider: AiProviderName, maximumUses: number) {
  if (provider === 'openrouter')
    return {
      tools: [
        {
          type: 'openrouter:web_search',
          parameters: {
            max_uses: maximumUses,
            max_results: 5,
            max_total_results: maximumUses * 5,
          },
        },
      ],
      tool_choice: 'required',
      max_tool_calls: maximumUses,
    }
  return {
    tools: [{ type: 'web_search', external_web_access: true }],
    tool_choice: 'required',
    max_tool_calls: maximumUses,
    include: ['web_search_call.action.sources'],
  }
}
