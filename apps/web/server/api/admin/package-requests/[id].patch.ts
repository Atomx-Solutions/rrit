import { z } from 'zod'
import {
  packageRequestChangeSchema,
  updatePackageRequest,
} from '../../../utils/admin-package-requests'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  // The superadmin server middleware has already verified the role.
  const actor = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  const change = packageRequestChangeSchema.safeParse(await boundedBody(event, 4096))
  if (!id.success || !change.success)
    throw createError({
      statusCode: 400,
      message: 'server.REQUEST_VALUES_INVALID',
      data: { code: 'REQUEST_INVALID' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return updatePackageRequest(id.data, { id: actor.id, email: actor.email }, change.data)
})
