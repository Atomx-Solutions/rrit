import { paddleEnabled, paddleWebhookSecret, verifyPaddleSignature, type PaddleWebhookEnvelope } from '../../utils/paddle'
import { database } from '../../utils/database'

export default defineEventHandler(async (event) => {
  if (!paddleEnabled())
    throw createError({ statusCode: 404, message: 'server.NOT_FOUND' })

  const rawBodyValue = await readRawBody(event, false)
  const rawBody = rawBodyValue == null
    ? null
    : typeof rawBodyValue === 'string'
      ? rawBodyValue
      : rawBodyValue.toString('utf8')
  const signature = getHeader(event, 'paddle-signature')
  const secret = paddleWebhookSecret()
  if (!rawBody || !signature || !secret || !verifyPaddleSignature(rawBody, signature, secret))
    throw createError({ statusCode: 401, message: 'server.UNAUTHORIZED' })

  let payload: PaddleWebhookEnvelope
  try {
    payload = JSON.parse(rawBody) as PaddleWebhookEnvelope
  } catch {
    throw createError({ statusCode: 400, message: 'server.VALUES_INVALID' })
  }
  if (!payload.event_id || !payload.event_type || !payload.data)
    throw createError({ statusCode: 400, message: 'server.VALUES_INVALID' })

  const data = payload.data as {
    id?: string
    status?: string
    custom_data?: { orderId?: string }
  }

  const client = await database().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE app_runtime')
    const inserted = await client.query(
      `INSERT INTO paddle_webhook_events(event_id,event_type,occurred_at,payload)
       VALUES($1,$2,$3,$4) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,
      [payload.event_id, payload.event_type, payload.occurred_at, payload],
    )
    if (payload.event_type === 'transaction.paid' || payload.event_type === 'transaction.completed') {
      if (!data.id || !data.custom_data?.orderId)
        throw createError({ statusCode: 400, message: 'server.PADDLE_PAYMENT_REFERENCE_INVALID' })
      await client.query(
        `SELECT app.process_paddle_payment($1,$2,$3)`,
        [data.custom_data.orderId, data.id, payload.event_id],
      )
    }
    await client.query(
      `UPDATE paddle_webhook_events SET processed_at=now() WHERE event_id=$1`,
      [payload.event_id],
    )
    await client.query('COMMIT')
    return { received: true, duplicate: inserted.rowCount === 0 }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
})

