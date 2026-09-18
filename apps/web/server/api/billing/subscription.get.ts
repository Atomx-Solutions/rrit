import {
  CREDIT_TOP_UP_MAXIMUM,
  CREDIT_TOP_UP_MINIMUM,
} from '../../utils/credit-top-ups'
import { creditPricing } from '../../utils/credits'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { subscription, pricing } = await withBusinessTransaction(user.id, async (client, business) => {
    const result = await client.query<{
      plan_code: string
      billing_interval: 'monthly' | 'annual'
      status: string
      current_period_start: Date
      current_period_end: Date
      price_cents: number | null
      pending_plan_code: string | null
    }>(
      `SELECT plan_code,billing_interval,status,current_period_start,current_period_end,
              price_cents,pending_plan_code
         FROM subscriptions
        WHERE organization_id=$1 AND status IN ('trialing','active','past_due')`,
      [business.id],
    )
    return { subscription: result.rows[0] || null, pricing: await creditPricing(client) }
  })
  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    selfServiceEnabled: process.env.BILLING_SELF_SERVICE_ENABLED === 'true',
    creditTopUp: {
      minimum: CREDIT_TOP_UP_MINIMUM,
      maximum: CREDIT_TOP_UP_MAXIMUM,
      unitPrice: pricing.creditPriceCents / 100,
    },
    subscription: subscription && {
      planCode: subscription.plan_code,
      interval: subscription.billing_interval,
      status: subscription.status,
      periodStart: new Date(subscription.current_period_start).toISOString(),
      periodEnd: new Date(subscription.current_period_end).toISOString(),
      price: subscription.price_cents === null ? null : subscription.price_cents / 100,
      pendingPlanCode: subscription.pending_plan_code,
    },
  }
})
