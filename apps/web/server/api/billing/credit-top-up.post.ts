import { z } from 'zod'
import { creditPricing, grantAdditionalCredits } from '../../utils/credits'
import { issueInvoice } from '../../utils/invoices'
import {
  CREDIT_TOP_UP_MAXIMUM,
  CREDIT_TOP_UP_MINIMUM,
  creditTopUpPriceCents,
} from '../../utils/credit-top-ups'

// This guarded path is only a test checkout. A payment-provider webhook will
// later call the same credit grant after a payment is confirmed.
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  if (process.env.BILLING_SELF_SERVICE_ENABLED !== 'true')
    throw createError({
      statusCode: 403,
      message: 'Pagesat nuk jane aktive ende.',
      data: { code: 'PAYMENTS_INACTIVE' },
    })

  const input = z.object({
    credits: z.number().int().min(CREDIT_TOP_UP_MINIMUM).max(CREDIT_TOP_UP_MAXIMUM),
    idempotencyKey: z.string().uuid(),
  }).safeParse(await boundedBody(event, 512))
  if (!input.success)
    throw createError({
      statusCode: 422,
      message: `Sasia duhet te jete nga ${CREDIT_TOP_UP_MINIMUM} deri ne ${CREDIT_TOP_UP_MAXIMUM} kredite.`,
      data: { code: 'INVALID_CREDIT_QUANTITY' },
    })

  const { balance, priceCents, invoiceNumber } = await withBusinessTransaction(user.id, async (client, business) => {
    const { creditPriceCents } = await creditPricing(client)
    const priceCents = creditTopUpPriceCents(input.data.credits, creditPriceCents)
    const subscription = await client.query<{ id: string }>(
      `SELECT id FROM subscriptions
        WHERE organization_id=$1 AND status IN ('trialing','active','past_due')
        ORDER BY current_period_end DESC LIMIT 1 FOR UPDATE`,
      [business.id],
    )
    const subscriptionId = subscription.rows[0]?.id
    if (!subscriptionId)
      throw createError({
        statusCode: 409,
        message: 'Nuk ka abonim aktiv per blerjen e krediteve.',
        data: { code: 'NO_ACTIVE_SUBSCRIPTION' },
      })
    const balance = await grantAdditionalCredits(client, {
      organizationId: business.id,
      subscriptionId,
      credits: input.data.credits,
      referenceType: 'credit_purchase_test',
      referenceId: input.data.idempotencyKey,
      idempotencyKey: `credit-purchase:${input.data.idempotencyKey}`,
      metadata: { priceCents, testMode: true },
    })
    const invoice = await issueInvoice(client, {
      organizationId: business.id,
      sourceType: 'credit_top_up',
      sourceReference: input.data.idempotencyKey,
      lines: [{ description: 'Kredite shtesë AI', quantity: input.data.credits, unitPriceCents: creditPriceCents }],
    })
    return { balance, priceCents, invoiceNumber: invoice.number }
  })

  setHeader(event, 'Cache-Control', 'private, no-store')
  return { credits: input.data.credits, price: priceCents / 100, balance, invoiceNumber }
})
