import { z } from 'zod'
import { brandCreateSchema } from '../../../../../shared/schemas/brand'
import { recordAuditEvent, transitionMetadata } from '../../../../utils/audit'
import { createBrand, withOrganizationTransaction } from '../../../../utils/brands'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  if (!organizationId.success) throw createError({ statusCode: 404, message: 'server.ORGANIZATION_NOT_FOUND' })
  const parsed = brandCreateSchema.safeParse(await boundedBody(event, 16384))
  if (!parsed.success) throw createError({ statusCode: 422, message: 'server.BRAND_DATA_INVALID' })
  try {
    const brand = await withOrganizationTransaction(user.id, organizationId.data, async (client) => {
      const brand = await createBrand(client, organizationId.data, parsed.data)
      await recordAuditEvent(client, {
        actorId: user.id,
        organizationId: organizationId.data,
        resourceType: 'brand',
        resourceId: brand.id,
        action: 'brand.created',
        metadata: transitionMetadata({
          status: [null, brand.status],
          name: [null, brand.name],
          slug: [null, brand.slug],
          city: [null, brand.profile.city],
          industry: [null, brand.profile.industry],
          color: [null, brand.profile.color],
        }),
      })
      return brand
    })
    setResponseStatus(event, 201)
    return brand
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      throw createError({ statusCode: 409, message: 'server.BRAND_SLUG_EXISTS' })
    throw error
  }
})
