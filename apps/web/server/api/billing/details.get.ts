import { billingDetails } from '../../utils/invoices'

// Invoices are handed over by the team rather than read from the app, so the
// tenant side serves only the billing details the customer maintains itself.
// The superadmin area remains the single place where invoices are listed.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const details = await withBusinessTransaction(user.id, (client, business) =>
    billingDetails(client, business.id),
  )
  setHeader(event, 'Cache-Control', 'private, no-store')
  return { details }
})
