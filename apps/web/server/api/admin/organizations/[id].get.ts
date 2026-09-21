import { adminOrganizationDetails, isOrganizationId } from '../../../utils/admin-organization-details'

export default defineEventHandler(async (event) => {
  const organizationId = getRouterParam(event, 'id')
  if (!isOrganizationId(organizationId))
    throw createError({ statusCode: 404, message: 'Organizata nuk u gjet.' })

  const details = await adminOrganizationDetails(organizationId)
  if (!details)
    throw createError({ statusCode: 404, message: 'Organizata nuk u gjet.' })

  setHeader(event, 'Cache-Control', 'private, no-store')
  return details
})
