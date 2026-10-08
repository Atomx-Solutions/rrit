import { z } from 'zod'
import { customPackageChangesSchema, updateCustomPackage } from '../../../../../utils/admin-custom-packages'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const actor = await requireUser(event)
  // The package carries its own organization; the route id only scopes the UI.
  const packageId = z.uuid().safeParse(getRouterParam(event, 'packageId'))
  const changes = customPackageChangesSchema.safeParse(await boundedBody(event, 4096))
  if (!packageId.success || !changes.success)
    throw createError({
      statusCode: 400,
      message: 'server.PACKAGE_VALUES_INVALID',
      data: { code: 'PACKAGE_INVALID' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return updateCustomPackage(packageId.data, { id: actor.id, email: actor.email }, changes.data)
})
