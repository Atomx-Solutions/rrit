import { adminAiCosts, adminAiCostsQuerySchema, adminAiCostsRange } from '../../../utils/admin-ai-costs'
import { openRouterAccount } from '../../../utils/openrouter-account'
import { aiProviderConfiguration } from '../../../utils/ai-provider'

export default defineEventHandler(async (event) => {
  const query = adminAiCostsQuerySchema.safeParse(getQuery(event))
  if (!query.success)
    throw createError({
      statusCode: 422,
      message: 'server.PERIOD_INVALID_RANGE',
      data: { code: 'INVALID_RANGE' },
    })
  const range = adminAiCostsRange(query.data)
  if (!range)
    throw createError({
      statusCode: 422,
      message: 'server.PERIOD_INVALID_RANGE',
      data: { code: 'INVALID_RANGE' },
    })
  setHeader(event, 'Cache-Control', 'private, no-store')
  // Our ledgers and the provider's own figures load in parallel.
  let keyFingerprint = ''
  try {
    keyFingerprint = aiProviderConfiguration().keyFingerprint
  } catch {
    // Without a configured key no call can be attributed to the platform.
  }
  const [costs, providerAccount] = await Promise.all([
    adminAiCosts(range, keyFingerprint),
    openRouterAccount(),
  ])
  return { ...costs, provider_account: providerAccount }
})
