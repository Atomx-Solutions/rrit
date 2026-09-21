import { adminUsers, adminUsersQuerySchema } from '../../../utils/admin-users'

export default defineEventHandler(async (event) => {
  const query = adminUsersQuerySchema.safeParse(getQuery(event))
  if (!query.success)
    throw createError({
      statusCode: 422,
      message: 'Parametrat e kërkimit nuk janë të vlefshëm.',
      data: { code: 'INVALID_QUERY' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return adminUsers(query.data)
})
