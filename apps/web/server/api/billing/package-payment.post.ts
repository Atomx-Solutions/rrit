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

    const activePackage = await client.query<{ id: string }>(
      `SELECT id FROM custom_packages WHERE organization_id=$1 AND status='active' LIMIT 1`,
      [business.id],
    )
    const isAddOn = activePackage.rowCount !== 0
    const invoiceQuantity = packageRow.posts_included === 0 && packageRow.videos_included > 0 && packageRow.credits_included === 0
      ? packageRow.videos_included
      : packageRow.videos_included === 0 && packageRow.posts_included > 0 && packageRow.credits_included === 0
        ? packageRow.posts_included
        : packageRow.posts_included === 0 && packageRow.videos_included === 0 && packageRow.credits_included > 0
          ? packageRow.credits_included
          : 1
    const invoiceLineQuantity = invoiceQuantity > 1 && packageRow.price_cents % invoiceQuantity === 0
      ? invoiceQuantity
      : 1
    const invoiceUnitAmount = packageRow.price_cents / invoiceLineQuantity

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM paddle_payment_orders WHERE package_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1`,
      [packageRow.id],
    )
    const order = existing.rows[0] || (await client.query<{ id: string }>(
      `INSERT INTO paddle_payment_orders
        (organization_id,package_id,purpose,posts_included,videos_included,credits_included,amount_cents,currency)
       VALUES($1,$2,$8,$3,$4,$5,$6,$7) RETURNING id`,
      [business.id, packageRow.id, packageRow.posts_included, packageRow.videos_included,
        packageRow.credits_included, packageRow.price_cents, packageRow.currency,
        isAddOn ? 'add_on' : 'parent_package'],
    )).rows[0]

    const transactionId = await createPaddleTransaction({
      amountCents: packageRow.price_cents,
      currency: packageRow.currency,
      description: `Framic purchase: ${packageRow.posts_included} posts, ${packageRow.videos_included} videos, ${packageRow.credits_included} credits`,
      name: `Framic — ${[
        packageRow.posts_included && `${packageRow.posts_included} ${packageRow.posts_included === 1 ? 'post' : 'posts'}`,
        packageRow.videos_included && `${packageRow.videos_included} ${packageRow.videos_included === 1 ? 'video' : 'videos'}`,
        packageRow.credits_included && `${packageRow.credits_included} credits`,
      ].filter(Boolean).join(' + ')}`,
      recurring: !isAddOn && (packageRow.posts_included > 0 || packageRow.videos_included > 0),
      quantity: invoiceLineQuantity,
      unitAmountCents: invoiceUnitAmount,
      customData: { orderId: order!.id, packageId: packageRow.id, organizationId: business.id },
    })
    await client.query(
      `UPDATE paddle_payment_orders SET paddle_transaction_id=$2,updated_at=now() WHERE id=$1`,
      [order!.id, transactionId],
    )
    return { orderId: order!.id, status: 'pending', paddleCheckoutReady: true, transactionId }
  })
})
