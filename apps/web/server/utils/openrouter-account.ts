// Live spend as OpenRouter itself reports it, next to our own ledgers. The
// regular API key can read its own usage (/key) and the account balance
// (/credits); the per-day activity breakdown needs a management key, so it is
// not requested here. Amounts from OpenRouter are in USD.
const OPENROUTER_API = 'https://openrouter.ai/api/v1'

type KeyData = {
  usage?: number
  usage_daily?: number
  usage_weekly?: number
  usage_monthly?: number
  limit?: number | null
  limit_remaining?: number | null
}
type CreditsData = { total_credits?: number; total_usage?: number }

export type ProviderAccount = {
  provider: 'openrouter'
  key: {
    usage_usd: number
    usage_daily_usd: number
    usage_weekly_usd: number
    usage_monthly_usd: number
    limit_usd: number | null
    limit_remaining_usd: number | null
  } | null
  account: { total_credits_usd: number; total_usage_usd: number; balance_usd: number } | null
  usd_micro_eur: number | null
  error: string | null
}

const usd = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

async function openRouterGet<T>(path: string, apiKey: string) {
  const response = await fetch(`${OPENROUTER_API}/${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`OPENROUTER_${response.status}`)
  return ((await response.json()) as { data?: T }).data
}

/** Never throws: the costs page still works when OpenRouter is unreachable. */
export async function openRouterAccount(): Promise<ProviderAccount | null> {
  const provider = (process.env.AI_PROVIDER || '').trim().toLowerCase()
  if (provider !== 'openrouter') return null
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  const rate = Number(process.env.AI_USD_MICRO_EUR)
  const base: ProviderAccount = {
    provider: 'openrouter',
    key: null,
    account: null,
    usd_micro_eur: Number.isSafeInteger(rate) && rate > 0 ? rate : null,
    error: null,
  }
  if (!apiKey || apiKey === 'EMPTY') return { ...base, error: 'NOT_CONFIGURED' }

  const [key, credits] = await Promise.allSettled([
    // OpenRouter's documented endpoint is /api/v1/key.
    openRouterGet<KeyData>('key', apiKey),
    openRouterGet<CreditsData>('credits', apiKey),
  ])
  if (key.status === 'fulfilled' && key.value)
    base.key = {
      usage_usd: usd(key.value.usage),
      usage_daily_usd: usd(key.value.usage_daily),
      usage_weekly_usd: usd(key.value.usage_weekly),
      usage_monthly_usd: usd(key.value.usage_monthly),
      limit_usd: key.value.limit ?? null,
      limit_remaining_usd: key.value.limit_remaining ?? null,
    }
  if (credits.status === 'fulfilled' && credits.value) {
    const total = usd(credits.value.total_credits)
    const used = usd(credits.value.total_usage)
    base.account = { total_credits_usd: total, total_usage_usd: used, balance_usd: Math.max(0, total - used) }
  }
  if (!base.key && !base.account) {
    const reason = key.status === 'rejected' ? key.reason : credits.status === 'rejected' ? credits.reason : null
    console.warn('OpenRouter account lookup failed.', { reason: reason instanceof Error ? reason.message : 'unknown' })
    base.error = 'UNAVAILABLE'
  }
  return base
}
