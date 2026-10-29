import { z } from 'zod'
import { reviewPostQuality } from '../../../utils/post-quality'
import { PlannerFailure, plannerMessageKey } from '../../../utils/monthly-planner-domain'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  const input = z
    .object({ contentVersion: z.number().int().positive() })
    .safeParse(await boundedBody(event, 1024))
  if (!id.success || !input.success)
    throw createError({ statusCode: 422, message: 'server.VERSION_INVALID' })
  const business = await withUserTransaction(user.id, (client) => businessForUser(user.id, client))
  try {
    return await reviewPostQuality(
      database(),
      { userId: user.id, organizationId: business.id },
      id.data,
      input.data.contentVersion,
    )
  } catch (error) {
    if (error instanceof PlannerFailure)
      throw createError({
        statusCode:
          error.code === 'POST_NOT_FOUND' ? 404 : error.code === 'POST_CHANGED' ? 409 : 422,
        message:
          plannerMessageKey(
            error.code,
            (
              {
                POST_CHANGED: 'planner.reviewPostChanged',
                POST_NOT_EDITABLE: 'planner.reviewNotEditable',
                CONTENT_CHECKS_REQUIRED: 'planner.reviewChecksRequired',
              } as Record<string, string>
            )[error.code] || 'planner.reviewFailed',
          ),
      })
    throw error
  }
})
