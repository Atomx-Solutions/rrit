import { z } from 'zod'
import { adminOrganizationInvoices } from '../../../../utils/admin-invoices'

export default defineEventHandler(async (event) => {
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!organizationId.success)
    throw createError({ statusCode: 404, message: 'server.ORGANIZATION_NOT_FOUND' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return { invoices: await adminOrganizationInvoices(organizationId.data) }
})
