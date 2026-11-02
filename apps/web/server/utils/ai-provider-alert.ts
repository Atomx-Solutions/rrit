import type { ProviderAccount } from './openrouter-account'

export type ProviderFailureKind = 'key_limit' | 'credit' | 'invalid_key' | 'refused'

/**
 * OpenRouter answers an exhausted key limit with 403, not 402, so the status
 * alone would read it as a configuration fault. The message says which it is.
 */
export function providerFailureKind(status: number, message?: string): ProviderFailureKind | null {
  if (/key limit exceeded/i.test(message || '')) return 'key_limit'
  if (status === 402) return 'credit'
  if (status === 401) return 'invalid_key'
  if (status === 403) return 'refused'
  return null
}

/**
 * What the platform can still spend: the account balance, capped by the key's
 * own limit when it has one. A key can be exhausted while the account still
 * holds credit, and then the AI stops just the same.
 */
export function providerAvailableUsd(account: ProviderAccount | null) {
  const balance = account?.account?.balance_usd ?? null
  const remaining = account?.key?.limit_usd == null ? null : account.key.limit_remaining_usd
  if (remaining == null) return { available_usd: balance, limited_by: 'account' as const }
  if (balance == null || remaining < balance)
    return { available_usd: Math.max(0, remaining), limited_by: 'key' as const }
  return { available_usd: balance, limited_by: 'account' as const }
}
