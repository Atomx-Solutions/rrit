import { isAdminApiPath, hasSuperadminRole } from '../utils/superadmin'

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (!isAdminApiPath(path)) return

  const user = await requireUser(event)
  const allowed = await withUserTransaction(user.id, (client) => hasSuperadminRole(client, user.id))
  if (!allowed)
    throw createError({
      statusCode: 403,
      message: 'Nuk ke akses.',
      data: { code: 'SUPERADMIN_REQUIRED' },
    })
  event.context.superadmin = user
})
