import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const leadConversionRangeSchema = z.object({ from: day, to: day }).refine(
  value => value.from <= value.to,
  { message: 'Invalid date range' },
)

export async function adminLeadConversionSummary(range: z.infer<typeof leadConversionRangeSchema>) {
  const from = `${range.from}T00:00:00.000Z`
  const end = new Date(`${range.to}T00:00:00.000Z`)
  end.setUTCDate(end.getUTCDate() + 1)
  const { data, error } = await adminServiceClient().rpc('admin_package_request_conversion_summary', {
    p_from: from, p_to: end.toISOString(),
  })
  if (error) throw createError({ statusCode: 502, message: 'Statistikat e konvertimit nuk u ngarkuan.' })
  const value = (data || {}) as Record<string, unknown>
  const count = (key: string) => Number(value[key]) || 0
  const total = count('total')
  return {
    total, new: count('new'), contacted: count('contacted'), proposalSent: count('proposal_sent'),
    won: count('won'), lost: count('lost'), conversionValueCents: count('conversion_value_cents'),
    conversionRate: total ? Math.round((count('won') / total) * 10_000) / 100 : 0,
  }
}
