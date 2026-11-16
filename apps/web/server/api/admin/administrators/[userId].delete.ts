import { z } from 'zod'
import { revokePlatformAdmin } from '../../../utils/admin-platform-admins'

// Removes the superadmin role; the account itself stays as it is.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const userId = z.uuid().safeParse(getRouterParam(event, 'userId'))
  if (!userId.success)
    throw createError({ statusCode: 404, message: 'server.REQUEST_DENIED', data: { code: 'ADMIN_NOT_FOUND' } })
  // The superadmin server middleware has already verified the role.
  const actor = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return revokePlatformAdmin({ id: actor.id, email: actor.email }, userId.data)
})
