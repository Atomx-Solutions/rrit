import { z } from 'zod'
import { createCustomPackage, customPackageCreateSchema } from '../../../../utils/admin-custom-packages'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const actor = await requireUser(event)
  const organizationId = z.uuid().safeParse(getRouterParam(event, 'id'))
  const values = customPackageCreateSchema.safeParse(await boundedBody(event, 4096))
  if (!organizationId.success || !values.success)
    throw createError({
      statusCode: 400,
      message: 'server.PACKAGE_VALUES_INVALID',
      data: { code: 'PACKAGE_INVALID' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return createCustomPackage(organizationId.data, { id: actor.id, email: actor.email }, values.data)
})
