import { adminOrganizationDetails, isOrganizationId } from '../../../utils/admin-organization-details'

export default defineEventHandler(async (event) => {
  const organizationId = getRouterParam(event, 'id')
  if (!isOrganizationId(organizationId))
    throw createError({ statusCode: 404, message: 'server.ORGANIZATION_NOT_FOUND' })

  const details = await adminOrganizationDetails(organizationId)
  if (!details)
    throw createError({ statusCode: 404, message: 'server.ORGANIZATION_NOT_FOUND' })

  setHeader(event, 'Cache-Control', 'private, no-store')
  return details
})
