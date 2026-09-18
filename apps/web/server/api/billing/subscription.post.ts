import { z } from 'zod'

// Until card payments are connected, activation without a payment is only
// allowed where BILLING_SELF_SERVICE_ENABLED=true (development and testing).
// The payment confirmation flow will call the same activation functions.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  if (process.env.BILLING_SELF_SERVICE_ENABLED !== 'true')
    throw createError({
      statusCode: 403,
      message: 'Pagesat nuk janë aktive ende.',
      data: { code: 'PAYMENTS_INACTIVE' },
    })
  const input = z
    .object({
      planCode: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
      interval: z.enum(['monthly', 'annual']),
    })
    .safeParse(await boundedBody(event, 512))
  if (!input.success)
    throw createError({ statusCode: 422, message: 'Kërkesa nuk është e vlefshme.' })
  const result = await withBusinessTransaction(user.id, async (client, business) => {
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [business.id])
    const current = await client.query<{ status: string; billing_interval: string }>(
      `SELECT status,billing_interval FROM subscriptions
        WHERE organization_id=$1 AND status IN ('active','past_due')`,
      [business.id],
    )
    const paid = current.rows[0]
    if (!paid)
      return activateSubscription(client, {
        organizationId: business.id,
        planCode: input.data.planCode,
        interval: input.data.interval,
      })
    if (paid.billing_interval !== input.data.interval)
      throw createError({
        statusCode: 409,
        message: 'Ndryshimi mes pagesës mujore dhe vjetore bëhet në fund të periudhës.',
        data: { code: 'INTERVAL_CHANGE_UNSUPPORTED' },
      })
    return changeSubscriptionPlan(client, {
      organizationId: business.id,
      planCode: input.data.planCode,
    })
  })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return result
})
