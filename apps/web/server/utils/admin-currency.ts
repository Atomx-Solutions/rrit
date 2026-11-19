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

/** The time zone the admin reports count days, weeks and months in. */
export async function adminReportingTimezone(): Promise<string> {
  const { data, error } = await adminServiceClient()
    .from('platform_settings')
    .select('reporting_timezone')
    .eq('singleton', true)
    .maybeSingle()
  if (error) {
    console.error('Admin time zone read failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'server.ADMIN_STATS_LOAD_FAILED' })
  }
  return data?.reporting_timezone || 'UTC'
}

/** The instant a calendar day (YYYY-MM-DD) starts in the given time zone. */
export function startOfDayIn(day: string, timeZone: string) {
  const utc = new Date(`${day}T00:00:00Z`)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(utc).map(part => [part.type, part.value]))
  const local = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!)
  return new Date(utc.getTime() - (local - utc.getTime())).toISOString()
}

/** The day after a calendar day (YYYY-MM-DD). */
export function nextDay(day: string) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/**
 * Adds up amounts that were stored in different currencies. Each row is
 * converted from its own currency first, so francs and euros are never summed
 * as if they were the same money. A row with `rate_date` is converted at that
 * day's rate, so past sales keep their value instead of moving with today's.
 */
export async function sumInCurrency<K extends string>(
  rows: Array<Record<string, unknown>>,
  fields: readonly K[],
  target: AdminCurrency,
): Promise<Record<K, number>> {
  const totals = Object.fromEntries(fields.map(field => [field, 0])) as Record<K, number>
  for (const row of rows) {
    const from = row.currency === 'EUR' ? 'EUR' : 'CHF'
    const on = typeof row.rate_date === 'string' ? row.rate_date : undefined
    const { rate } = await getExchangeRate(from, target, on)
    for (const field of fields) {
      const cents = Number(row[field])
      if (Number.isFinite(cents)) totals[field] += Math.round(cents * rate)
    }
  }
  return totals
}
