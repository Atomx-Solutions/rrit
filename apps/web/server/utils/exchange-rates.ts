type CachedRate = { rate: number; date: string; expiresAt: number }

const cache = new Map<string, CachedRate>()
const cacheTtlMs = 6 * 60 * 60 * 1000

export async function getExchangeRate(from: string, to: string) {
  const base = from.toUpperCase()
  const quote = to.toUpperCase()
  if (base === quote)
    return { base, quote, rate: 1, date: new Date().toISOString().slice(0, 10) }
  const key = `${base}:${quote}`
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now())
    return { base, quote, rate: cached.rate, date: cached.date }

  let response: { base: string; quote: string; rate: number; date: string }
  try {
    response = await $fetch<{ base: string; quote: string; rate: number; date: string }>(
      `https://api.frankfurter.dev/v2/rate/${base.toLowerCase()}/${quote.toLowerCase()}`,
      { timeout: 5000 },
    )
  } catch {
    // Keep the last known rate when the provider is temporarily unavailable or
    // rate-limits us. A stale quote is preferable to breaking the customer flow.
    if (cached)
      return { base, quote, rate: cached.rate, date: cached.date }
    const fallback = Number(process.env.EUR_CHF_FALLBACK_RATE || 0.93)
    if (base === 'EUR' && quote === 'CHF' && Number.isFinite(fallback) && fallback > 0) {
      const date = new Date().toISOString().slice(0, 10)
      cache.set(key, { rate: fallback, date, expiresAt: Date.now() + cacheTtlMs })
      return { base, quote, rate: fallback, date }
    }
    throw new Error('Exchange rate unavailable')
  }
  if (!Number.isFinite(response.rate) || response.rate <= 0)
    throw new Error('Invalid exchange rate response')
  cache.set(key, { rate: response.rate, date: response.date, expiresAt: Date.now() + cacheTtlMs })
  return response
}

export function convertCurrency(amount: number, rate: number, decimals = 2) {
  const factor = 10 ** decimals
  return Math.round(amount * rate * factor) / factor
}
