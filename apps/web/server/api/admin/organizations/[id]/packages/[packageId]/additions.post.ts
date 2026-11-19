import { z } from 'zod'
import { addToPackage, packageAdditionSchema } from '../../../../../../utils/admin-custom-packages'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const actor = await requireUser(event)
  const packageId = z.uuid().safeParse(getRouterParam(event, 'packageId'))
  const addition = packageAdditionSchema.safeParse(await boundedBody(event, 2048))
  if (!packageId.success || !addition.success)
    throw createError({
      statusCode: 400,
      message: addition.error?.issues[0]?.message.startsWith('server.')
        ? addition.error.issues[0].message
        : 'server.PACKAGE_VALUES_INVALID',
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return addToPackage(packageId.data, { id: actor.id, email: actor.email }, addition.data)
})
