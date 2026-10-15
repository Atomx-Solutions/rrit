import { adminServiceClient } from './admin-supabase'
import { getExchangeRate } from './exchange-rates'

export type AdminCurrency = 'CHF' | 'EUR'

/** The currency the superadmin reads every total in (Admin → Settings). */
export async function adminCurrency(): Promise<AdminCurrency> {
  const { data, error } = await adminServiceClient()
    .from('platform_settings')
    .select('package_currency')
    .eq('singleton', true)
    .maybeSingle()
  if (error) {
    console.error('Admin currency read failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.ADMIN_STATS_LOAD_FAILED' })
  }
  return data?.package_currency === 'EUR' ? 'EUR' : 'CHF'
}

/**
 * Adds up amounts that were stored in different currencies. Each row is
 * converted from its own currency first, so francs and euros are never summed
 * as if they were the same money.
 */
export async function sumInCurrency<K extends string>(
  rows: Array<Record<string, unknown>>,
  fields: readonly K[],
  target: AdminCurrency,
): Promise<Record<K, number>> {
  const totals = Object.fromEntries(fields.map(field => [field, 0])) as Record<K, number>
  const rates = new Map<string, number>()
  for (const row of rows) {
    const from = row.currency === 'EUR' ? 'EUR' : 'CHF'
    if (!rates.has(from)) rates.set(from, (await getExchangeRate(from, target)).rate)
    const rate = rates.get(from)!
    for (const field of fields) {
      const cents = Number(row[field])
      if (Number.isFinite(cents)) totals[field] += Math.round(cents * rate)
    }
  }
  return totals
}
