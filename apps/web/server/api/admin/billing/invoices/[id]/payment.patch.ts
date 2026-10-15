import { z } from 'zod'
import { invoicePaymentChangeSchema, setInvoicePayment } from '../../../../../utils/admin-billing'
import { adminChangeBody } from '../../../../../utils/admin-plans'

export default defineEventHandler(async (event) => {
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success)
    throw createError({ statusCode: 400, message: 'server.REQUEST_PARAMETERS_INVALID' })
  const change = await adminChangeBody(event, invoicePaymentChangeSchema)
  const actor = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return setInvoicePayment({ id: actor.id, email: actor.email }, id.data, change)
})
