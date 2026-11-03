import { z } from 'zod'
import { createPaddleTransaction, paddleEnabled } from '../../utils/paddle'
import { belowPaddleMinimum } from '../../../shared/utils/paddle-minimum'
import { paddlePackageLines } from '../../utils/paddle-package-lines'

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
      credits_included: number; price_cents: number; currency: string; post_price_cents: number; video_price_cents: number
    }>(
      `SELECT id,organization_id,posts_included,videos_included,credits_included,price_cents,currency,
              post_price_cents,video_price_cents
         FROM custom_packages WHERE id=$1 AND organization_id=$2 AND status='draft'`,
      [body.data.packageId, business.id],
    )
    const packageRow = result.rows[0]
    if (!packageRow) throw createError({ statusCode: 404, message: 'server.PACKAGE_NOT_FOUND' })
    if (packageRow.price_cents <= 0) throw createError({ statusCode: 422, message: 'server.PACKAGE_PRICE_INVALID' })
    if (belowPaddleMinimum(packageRow.price_cents, packageRow.currency))
      throw createError({ statusCode: 422, message: 'server.PAYMENT_BELOW_MINIMUM', data: { code: 'PAYMENT_BELOW_MINIMUM' } })

    const activePackage = await client.query<{ id: string }>(
      `SELECT id FROM custom_packages WHERE organization_id=$1 AND status='active' LIMIT 1`,
      [business.id],
    )
    const isAddOn = activePackage.rowCount !== 0
    // Videos and credits are only sold on top of a running package; without one
    // the offer has to be a package with posts.
    if (!isAddOn && packageRow.posts_included === 0)
      throw createError({ statusCode: 409, message: 'server.ACTIVE_PACKAGE_REQUIRED' })
    // A pending order is reused, but always rewritten from the offer as it is
    // now: the team may have changed the offer since the last checkout, and
    // the webhook grants what the order says.
    const orderValues = [packageRow.posts_included, packageRow.videos_included, packageRow.credits_included,
      packageRow.price_cents, packageRow.currency, isAddOn ? 'add_on' : 'parent_package']
    const existing = await client.query<{ id: string }>(
      `UPDATE paddle_payment_orders
          SET posts_included=$2,videos_included=$3,credits_included=$4,amount_cents=$5,currency=$6,purpose=$7,updated_at=now()
        WHERE id=(SELECT id FROM paddle_payment_orders WHERE package_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1)
        RETURNING id`,
      [packageRow.id, ...orderValues],
    )
    const order = existing.rows[0] || (await client.query<{ id: string }>(
      `INSERT INTO paddle_payment_orders
        (organization_id,package_id,posts_included,videos_included,credits_included,amount_cents,currency,purpose)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [business.id, packageRow.id, ...orderValues],
    )).rows[0]

    const name = `Framic — ${[
      packageRow.posts_included && `${packageRow.posts_included} ${packageRow.posts_included === 1 ? 'post' : 'posts'}`,
      packageRow.videos_included && `${packageRow.videos_included} ${packageRow.videos_included === 1 ? 'video' : 'videos'}`,
      packageRow.credits_included && `${packageRow.credits_included} credits`,
    ].filter(Boolean).join(' + ')}`
    const { lines, adjustable } = paddlePackageLines(packageRow, name)
    const transactionId = await createPaddleTransaction({
      amountCents: packageRow.price_cents,
      currency: packageRow.currency,
      description: `Framic purchase: ${packageRow.posts_included} posts, ${packageRow.videos_included} videos, ${packageRow.credits_included} credits`,
      name,
      recurring: !isAddOn && (packageRow.posts_included > 0 || packageRow.videos_included > 0),
      adjustableQuantity: adjustable,
      lineItems: lines,
      customData: { orderId: order!.id, packageId: packageRow.id, organizationId: business.id },
    })
    await client.query(
      `UPDATE paddle_payment_orders SET paddle_transaction_id=$2,updated_at=now() WHERE id=$1`,
      [order!.id, transactionId],
    )
    return { orderId: order!.id, status: 'pending', paddleCheckoutReady: true, transactionId }
  })
})
