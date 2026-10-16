import { z } from 'zod'
import { deleteCustomPackage } from '../../../../../utils/admin-custom-packages'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const actor = await requireUser(event)
  const packageId = z.uuid().safeParse(getRouterParam(event, 'packageId'))
  if (!packageId.success)
    throw createError({ statusCode: 400, message: 'server.PACKAGE_VALUES_INVALID' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return deleteCustomPackage(packageId.data, { id: actor.id, email: actor.email })
})
