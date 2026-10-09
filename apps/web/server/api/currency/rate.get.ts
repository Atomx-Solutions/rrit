import { z } from 'zod'
import { getExchangeRate } from '../../utils/exchange-rates'

const querySchema = z.object({
  from: z.enum(['EUR', 'CHF']).default('EUR'),
  to: z.enum(['EUR', 'CHF']).default('CHF'),
})

export default defineEventHandler(async (event) => {
  const query = querySchema.parse(getQuery(event))
  try {
    const result = await getExchangeRate(query.from, query.to)
    setHeader(event, 'Cache-Control', 'private, max-age=21600')
    return result
  } catch {
    throw createError({ statusCode: 503, message: 'server.EXCHANGE_RATE_UNAVAILABLE' })
  }
})
