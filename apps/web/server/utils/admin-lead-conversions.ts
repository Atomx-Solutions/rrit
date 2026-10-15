import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'
import { adminCurrency, sumInCurrency } from './admin-currency'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const leadConversionRangeSchema = z.object({ from: day, to: day }).refine(
  value => value.from <= value.to,
  { message: 'server.INVALID_DATE_RANGE' },
)

export async function adminLeadConversionSummary(range: z.infer<typeof leadConversionRangeSchema>) {
  const from = `${range.from}T00:00:00.000Z`
  const end = new Date(`${range.to}T00:00:00.000Z`)
  end.setUTCDate(end.getUTCDate() + 1)
  const rangeArgs = { p_from: from, p_to: end.toISOString() }
  const [{ data, error }, byCurrency, currency] = await Promise.all([
    adminServiceClient().rpc('admin_package_request_conversion_summary', rangeArgs),
    adminServiceClient().rpc('admin_package_request_conversion_value_by_currency', rangeArgs),
    adminCurrency(),
  ])
  if (error || byCurrency.error) throw createError({ statusCode: 502, message: 'server.CONVERSION_STATS_LOAD_FAILED' })
  // Won leads are valued in their invoice's, package's or the current rates'
  // currency; each part is converted before it is added.
  const { cents: conversionValueCents } = await sumInCurrency(
    (Array.isArray(byCurrency.data) ? byCurrency.data : []) as Array<Record<string, unknown>>,
    ['cents'] as const,
    currency,
  )
  const value = (data || {}) as Record<string, unknown>
  const count = (key: string) => Number(value[key]) || 0
  const total = count('total')
  return {
    total, new: count('new'), contacted: count('contacted'), proposalSent: count('proposal_sent'),
    won: count('won'), lost: count('lost'), conversionValueCents, currency,
    conversionRate: total ? Math.round((count('won') / total) * 10_000) / 100 : 0,
  }
}
