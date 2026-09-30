import { adminLeadConversionSummary, leadConversionRangeSchema } from '../../../utils/admin-lead-conversions'

export default defineEventHandler(async (event) => {
  const range = leadConversionRangeSchema.safeParse(getQuery(event))
  if (!range.success) throw createError({ statusCode: 400, message: 'Periudha nuk është e vlefshme.' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return adminLeadConversionSummary(range.data)
})
