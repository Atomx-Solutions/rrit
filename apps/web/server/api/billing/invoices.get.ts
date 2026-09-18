import { billingDetails, listInvoices } from '../../utils/invoices'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const result = await withBusinessTransaction(user.id, async (client, business) => ({
    invoices: await listInvoices(client, business.id),
    details: await billingDetails(client, business.id),
  }))
  setHeader(event, 'Cache-Control', 'private, no-store')
  return result
})
