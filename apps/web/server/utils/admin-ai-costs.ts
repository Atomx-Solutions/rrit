import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
export const adminAiCostsQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  scope: z.enum(['current', 'all']).optional(),
})

const DAY = 24 * 60 * 60 * 1000
const MAX_RANGE_DAYS = 366

/**
 * Whole UTC days: from the start of `from` up to the end of `to`. Defaults to
 * the current month so far (the 1st up to and including today).
 */
export function adminAiCostsRange(query: z.infer<typeof adminAiCostsQuerySchema>, now = new Date()) {
  const today = now.toISOString().slice(0, 10)
  const from = new Date(`${query.from || `${today.slice(0, 8)}01`}T00:00:00Z`)
  const toExclusive = new Date(new Date(`${query.to || today}T00:00:00Z`).getTime() + DAY)
  if (from >= toExclusive || toExclusive.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY) return null
  return { from, toExclusive }
}

export async function adminAiCosts(
  range: { from: Date; toExclusive: Date },
  keyFingerprint: string,
  onlyCurrentKey = true,
) {
  const { data, error } = await adminServiceClient().rpc('admin_ai_costs', {
    p_from: range.from.toISOString(),
    p_to: range.toExclusive.toISOString(),
    p_current_key: keyFingerprint,
    p_only_current: onlyCurrentKey,
  })
  if (error) {
    console.error('Admin AI costs query failed.', { code: error.code, message: error.message })
    throw createError({ statusCode: 502, message: 'Kostot e AI-së nuk u ngarkuan.' })
  }
  return data as Record<string, unknown>
}
