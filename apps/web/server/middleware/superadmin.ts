import { isAdminApiPath, hasSuperadminRole, signedInWithMicrosoft } from '../utils/superadmin'
export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (!isAdminApiPath(path)) return

  const { user, signIn } = await requireUserSignIn(event)
  // The company Microsoft sign-in is the admin console's only door: it brings
  // Microsoft's second factor, which a Framic password alone does not.
  if (!signedInWithMicrosoft(signIn))
    throw createError({
      statusCode: 403,
      message: 'server.ACCESS_DENIED',
      data: { code: 'MICROSOFT_SIGN_IN_REQUIRED' },
    })
  const allowed = await withUserTransaction(user.id, (client) => hasSuperadminRole(client, user.id))
  if (!allowed)
    throw createError({
      statusCode: 403,
      message: 'server.ACCESS_DENIED',
      data: { code: 'SUPERADMIN_REQUIRED' },
    })
  event.context.superadmin = user
})
