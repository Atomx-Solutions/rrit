import { adminBillingOrganizations } from '../../../utils/admin-billing'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return adminBillingOrganizations()
})
