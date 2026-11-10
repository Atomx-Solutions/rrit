import { appLocaleSchema } from '../../../shared/schemas/workspace'
import {
  briefImprovementInput,
  improveBriefField,
  returnBriefImprovement,
  takeBriefImprovement,
} from '../../utils/onboarding-brief'

// "Improve with AI" for one field of the sign-up brief. It runs before the
// business and its credits exist, so it is free and limited per person.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const parsed = briefImprovementInput
    .extend({ locale: appLocaleSchema })
    .safeParse(await boundedBody(event, 16384))
  if (!parsed.success)
    throw createError({ statusCode: 422, message: 'server.BRIEF_TEXT_REQUIRED' })
  const remaining = await withUserTransaction(user.id, (client) => takeBriefImprovement(client, user.id))
  if (remaining === null)
    throw createError({ statusCode: 429, message: 'server.BRIEF_IMPROVEMENTS_USED' })
  try {
    return { ...(await improveBriefField(parsed.data, parsed.data.locale)).output, remaining }
  } catch (error) {
    await withUserTransaction(user.id, (client) => returnBriefImprovement(client, user.id)).catch(() => {})
    if (error instanceof Error)
      console.warn('A brief improvement failed', { error: error.message })
    throw createError({ statusCode: 502, message: 'server.AI_RESPONSE_INCOMPLETE' })
  }
})
