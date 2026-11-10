import { z } from 'zod'
import { appLocaleSchema } from '../../../shared/schemas/workspace'
import { chargedTextAi } from '../../utils/charged-text-ai'
import { briefImprovementInput, improveBriefField, type BriefImprovement } from '../../utils/onboarding-brief'

// "Improve with AI" for a brief field under My business. Unlike sign-up, the
// business exists here, so it is charged to the business's credits.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const business = await withUserTransaction(user.id, (client) => businessForUser(user.id, client))
  const parsed = briefImprovementInput
    .extend({ requestId: z.uuid(), locale: appLocaleSchema })
    .safeParse(await boundedBody(event, 16384))
  if (!parsed.success) throw createError({ statusCode: 422, message: 'server.BRIEF_TEXT_REQUIRED' })
  const { requestId, locale, ...input } = parsed.data
  return chargedTextAi<BriefImprovement>(user.id, business.id, {
    requestId,
    input: { ...input, locale },
    kind: 'brief',
    reservedInputTokens: 1500,
    reservedOutputTokens: 1200,
    run: () => improveBriefField(input, locale),
  })
})
