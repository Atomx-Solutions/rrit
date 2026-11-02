import { describe, expect, it } from 'vitest'
import { providerAvailableUsd, providerFailureKind } from '../../server/utils/ai-provider-alert'
import { providerHttpFailure } from '../../server/utils/monthly-ai'
import type { ProviderAccount } from '../../server/utils/openrouter-account'

const account = (balance: number | null, limit: number | null, remaining: number | null): ProviderAccount => ({
  provider: 'openrouter',
  key: { usage_usd: 0, usage_daily_usd: 0, usage_weekly_usd: 0, usage_monthly_usd: 0, limit_usd: limit, limit_remaining_usd: remaining },
  account: balance === null ? null : { total_credits_usd: balance, total_usage_usd: 0, balance_usd: balance },
  usd_micro_eur: null,
  error: null,
})

describe('AI provider alert', () => {
  it('reads an exhausted OpenRouter key limit as a credit failure, not configuration', () => {
    const message = 'Key limit exceeded (total limit). $20.28 of $20.00 used; does not reset.'
    expect(providerFailureKind(403, message)).toBe('key_limit')
    expect(providerHttpFailure(403, { status: 403, providerMessage: message }).code).toBe('PROVIDER_CREDIT_REQUIRED')
  })

  it('keeps other refusals apart', () => {
    expect(providerFailureKind(402)).toBe('credit')
    expect(providerFailureKind(401)).toBe('invalid_key')
    expect(providerFailureKind(403, 'Input was flagged')).toBe('refused')
    expect(providerHttpFailure(403, { status: 403, providerMessage: 'Input was flagged' }).code).toBe('CONFIGURATION_REQUIRED')
    expect(providerFailureKind(429)).toBeNull()
  })

  it('caps the account balance by what the key may still spend', () => {
    expect(providerAvailableUsd(account(150, 20, 0))).toEqual({ available_usd: 0, limited_by: 'key' })
    expect(providerAvailableUsd(account(5, 20, 12))).toEqual({ available_usd: 5, limited_by: 'account' })
    expect(providerAvailableUsd(account(150, null, null))).toEqual({ available_usd: 150, limited_by: 'account' })
    expect(providerAvailableUsd(account(null, 20, 3))).toEqual({ available_usd: 3, limited_by: 'key' })
  })
})
