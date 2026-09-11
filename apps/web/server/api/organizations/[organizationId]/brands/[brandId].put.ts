import { z } from 'zod'
import { brandUpdateSchema } from '../../../../../shared/schemas/brand'
import { brandAuditMetadata, recordAuditEvent } from '../../../../utils/audit'
import { getBrand, updateBrand, withOrganizationTransaction } from '../../../../utils/brands'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  const brandId = z.uuid().safeParse(getRouterParam(event, 'brandId'))
  if (!organizationId.success || !brandId.success)
    throw createError({ statusCode: 404, message: 'Brandi nuk u gjet.' })
  const parsed = brandUpdateSchema.safeParse(await boundedBody(event, 16384))
  if (!parsed.success) throw createError({ statusCode: 422, message: 'Të dhënat e brandit nuk janë valide.' })
  try {
    return await withOrganizationTransaction(user.id, organizationId.data, async (client) => {
      const previous = await getBrand(client, organizationId.data, brandId.data)
      const brand = await updateBrand(client, organizationId.data, brandId.data, parsed.data)
      await recordAuditEvent(client, {
        actorId: user.id,
        organizationId: organizationId.data,
        resourceType: 'brand',
        resourceId: brand.id,
        action: 'brand.updated',
        metadata: brandAuditMetadata(previous, brand),
      })
      return brand
    })
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      throw createError({ statusCode: 409, message: 'Slug-u i brandit ekziston në këtë organizatë.' })
    throw error
  }
})
