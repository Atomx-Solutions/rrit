import { z } from 'zod'
import { adminInviteSchema, resendAdminInvite } from '../../../../utils/admin-platform-admins'

// Emails an administrator the sign-in instructions again, for when the first
// email failed or was lost. It grants nothing: the role must already exist.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const userId = z.uuid().safeParse(getRouterParam(event, 'userId'))
  if (!userId.success)
    throw createError({ statusCode: 404, message: 'server.REQUEST_DENIED', data: { code: 'ADMIN_NOT_FOUND' } })
  const body = adminInviteSchema.safeParse(await boundedBody(event, 1024))
  if (!body.success)
    throw createError({ statusCode: 400, message: 'server.VALUES_INVALID', data: { code: 'INVALID_BODY' } })
  // The superadmin server middleware has already verified the role.
  const actor = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return resendAdminInvite({ email: actor.email }, userId.data, body.data.locale)
})
