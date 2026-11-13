import { adminEmailSchema, grantPlatformAdmin } from '../../../utils/admin-platform-admins'

// Gives the address the superadmin role at once; its owner signs in with
// the company Microsoft account, the console's only sign-in.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const body = adminEmailSchema.safeParse(await boundedBody(event, 1024))
  if (!body.success)
    throw createError({ statusCode: 400, message: 'server.VALUES_INVALID', data: { code: 'INVALID_BODY' } })
  // The superadmin server middleware has already verified the role.
  const actor = await requireUser(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  return grantPlatformAdmin({ id: actor.id, email: actor.email }, body.data.email)
})
