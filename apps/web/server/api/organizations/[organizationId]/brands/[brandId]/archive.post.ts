import { z } from 'zod'
import { recordAuditEvent, transitionMetadata } from '../../../../../utils/audit'
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
    const brand = await archiveBrand(client, organizationId.data, brandId.data)
    await recordAuditEvent(client, {
      actorId: user.id,
      organizationId: organizationId.data,
      resourceType: 'brand',
      resourceId: brand.id,
      action: 'brand.archived',
      metadata: transitionMetadata({ status: ['active', 'archived'] }),
    })
    return brand
  })
})
