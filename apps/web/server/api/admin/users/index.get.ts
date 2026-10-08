import { adminUsers, adminUsersQuerySchema } from '../../../utils/admin-users'

export default defineEventHandler(async (event) => {
  const query = adminUsersQuerySchema.safeParse(getQuery(event))
  if (!query.success)
    throw createError({
      statusCode: 422,
      message: 'server.SEARCH_PARAMETERS_INVALID',
      data: { code: 'INVALID_QUERY' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return adminUsers(query.data)
})
