import { z } from 'zod'
import { currentPostQuality } from '../../../utils/post-quality'
import { PlannerFailure } from '../../../utils/monthly-planner-domain'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 422, message: 'server.POST_INVALID' })
  const business = await withUserTransaction(user.id, (client) => businessForUser(user.id, client))
  try {
    return await currentPostQuality(
      database(),
      { userId: user.id, organizationId: business.id },
      id.data,
    )
  } catch (error) {
    if (error instanceof PlannerFailure && error.code === 'POST_NOT_FOUND')
      throw createError({ statusCode: 404, message: 'server.POST_NOT_FOUND' })
    throw error
  }
})
