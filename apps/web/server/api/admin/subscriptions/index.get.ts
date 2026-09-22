import { adminListSubscriptions, adminSubscriptionsQuerySchema } from '../../../utils/admin-subscriptions'

export default defineEventHandler(async (event) => {
  const parsed = adminSubscriptionsQuerySchema.safeParse(getQuery(event))
  if (!parsed.success)
    throw createError({ statusCode: 400, message: 'Parametrat e kërkesës janë të pavlefshëm.' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return adminListSubscriptions(parsed.data)
})
