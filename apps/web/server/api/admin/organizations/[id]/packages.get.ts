import { z } from 'zod'
import { adminOrganizationPackages } from '../../../../utils/admin-custom-packages'

export default defineEventHandler(async (event) => {
  // The superadmin server middleware has already verified the role.
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!organizationId.success)
    throw createError({
      statusCode: 404,
      message: 'server.ORGANIZATION_NOT_FOUND',
      data: { code: 'ORGANIZATION_NOT_FOUND' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return adminOrganizationPackages(organizationId.data)
})
