import { z } from 'zod'
import { brandCreateSchema } from '../../../../../shared/schemas/brand'
import { createBrand, withOrganizationTransaction } from '../../../../utils/brands'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'organizationId'))
  if (!organizationId.success) throw createError({ statusCode: 404, message: 'Organizata nuk u gjet.' })
  const parsed = brandCreateSchema.safeParse(await boundedBody(event, 16384))
  if (!parsed.success) throw createError({ statusCode: 422, message: 'Të dhënat e brandit nuk janë valide.' })
  try {
    const brand = await withOrganizationTransaction(user.id, organizationId.data, (client) =>
      createBrand(client, organizationId.data, parsed.data),
    )
    setResponseStatus(event, 201)
    return brand
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      throw createError({ statusCode: 409, message: 'Slug-u i brandit ekziston në këtë organizatë.' })
    throw error
  }
})
