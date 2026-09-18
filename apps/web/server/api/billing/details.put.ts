import { z } from 'zod'
import { saveBillingDetails } from '../../utils/invoices'

const text = (max: number) => z.string().trim().max(max)

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const input = z.object({
    legalName: text(160).min(2),
    address: text(240),
    city: text(120),
    country: text(120),
    fiscalNumber: text(40),
  }).safeParse(await boundedBody(event, 2048))
  if (!input.success)
    throw createError({ statusCode: 422, message: 'Të dhënat e faturimit nuk janë të vlefshme.', data: { code: 'INVALID_BILLING_DETAILS' } })
  const details = await withBusinessTransaction(user.id, (client, business) =>
    saveBillingDetails(client, business.id, input.data),
  )
  setHeader(event, 'Cache-Control', 'private, no-store')
  return details
})
