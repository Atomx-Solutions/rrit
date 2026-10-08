import { adminBillingInvoices, adminBillingInvoicesQuerySchema } from '../../../utils/admin-billing'

export default defineEventHandler(async (event) => {
  const parsed = adminBillingInvoicesQuerySchema.safeParse(getQuery(event))
  if (!parsed.success)
    throw createError({ statusCode: 400, message: 'server.REQUEST_PARAMETERS_INVALID' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return adminBillingInvoices(parsed.data)
})
