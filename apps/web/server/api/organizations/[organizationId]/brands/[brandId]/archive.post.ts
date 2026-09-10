import { z } from 'zod'
import { archiveBrand, requireOrganizationManager, withOrganizationTransaction } from '../../../../../utils/brands'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  const brandId = z.uuid().safeParse(getRouterParam(event, 'brandId'))
  if (!organizationId.success || !brandId.success)
    throw createError({ statusCode: 404, message: 'Brandi nuk u gjet.' })
  return withOrganizationTransaction(user.id, organizationId.data, async (client) => {
    await requireOrganizationManager(client, user.id, organizationId.data)
    return archiveBrand(client, organizationId.data, brandId.data)
  })
})
