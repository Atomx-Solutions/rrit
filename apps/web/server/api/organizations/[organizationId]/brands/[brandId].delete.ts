import { z } from 'zod'
import { recordAuditEvent, transitionMetadata } from '../../../../utils/audit'
import { deleteArchivedBrand, getBrand, requireOrganizationManager, withOrganizationTransaction } from '../../../../utils/brands'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  const brandId = z.uuid().safeParse(getRouterParam(event, 'brandId'))
  if (!organizationId.success || !brandId.success)
    throw createError({ statusCode: 404, message: 'server.BRAND_NOT_FOUND' })
  return withOrganizationTransaction(user.id, organizationId.data, async (client) => {
    await requireOrganizationManager(client, user.id, organizationId.data)
    const previous = await getBrand(client, organizationId.data, brandId.data)
    const result = await deleteArchivedBrand(client, organizationId.data, brandId.data)
    await recordAuditEvent(client, {
      actorId: user.id,
      organizationId: organizationId.data,
      resourceType: 'brand',
      resourceId: brandId.data,
      action: 'brand.deleted',
      metadata: transitionMetadata({
        status: [previous.status, 'deleted'],
        name: [previous.name, null],
        slug: [previous.slug, null],
        city: [previous.profile.city, null],
        industry: [previous.profile.industry, null],
      }),
    })
    return result
  })
})
