import { z } from 'zod'
import { createPaddleTransaction, paddleEnabled } from '../../utils/paddle'

const bodySchema = z.object({ packageId: z.uuid() }).strict()

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const body = bodySchema.safeParse(await readBody(event))
  if (!body.success)
    throw createError({ statusCode: 400, message: 'server.VALUES_INVALID' })

  if (!paddleEnabled())
    throw createError({ statusCode: 503, message: 'server.PAYMENTS_NOT_CONFIGURED', data: { code: 'PADDLE_NOT_CONFIGURED' } })

  return withBusinessTransaction(user.id, async (client, business) => {
    const result = await client.query<{
      id: string; organization_id: string; posts_included: number; videos_included: number
      credits_included: number; price_cents: number; currency: string
    }>(
      `SELECT id,organization_id,posts_included,videos_included,credits_included,price_cents,currency
         FROM custom_packages WHERE id=$1 AND organization_id=$2 AND status='draft'`,
      [body.data.packageId, business.id],
    )
    const packageRow = result.rows[0]
    if (!packageRow) throw createError({ statusCode: 404, message: 'server.PACKAGE_NOT_FOUND' })
    if (packageRow.price_cents <= 0) throw createError({ statusCode: 422, message: 'server.PACKAGE_PRICE_INVALID' })

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM paddle_payment_orders WHERE package_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1`,
      [packageRow.id],
    )
    const order = existing.rows[0] || (await client.query<{ id: string }>(
      `INSERT INTO paddle_payment_orders
        (organization_id,package_id,purpose,posts_included,videos_included,credits_included,amount_cents,currency)
       VALUES($1,$2,'parent_package',$3,$4,$5,$6,$7) RETURNING id`,
      [business.id, packageRow.id, packageRow.posts_included, packageRow.videos_included,
        packageRow.credits_included, packageRow.price_cents, packageRow.currency],
    )).rows[0]

    const transactionId = await createPaddleTransaction({
      amountCents: packageRow.price_cents,
      currency: packageRow.currency,
      description: 'Framic content package',
      name: packageRow.posts_included || packageRow.videos_included
        ? 'Framic content package'
        : 'Framic additional credits',
      recurring: packageRow.posts_included > 0 || packageRow.videos_included > 0,
      customData: { orderId: order!.id, packageId: packageRow.id, organizationId: business.id },
    })
    await client.query(
      `UPDATE paddle_payment_orders SET paddle_transaction_id=$2,updated_at=now() WHERE id=$1`,
      [order!.id, transactionId],
    )
    return { orderId: order!.id, status: 'pending', paddleCheckoutReady: true, transactionId }
  })
})
