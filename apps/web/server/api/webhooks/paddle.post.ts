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

  const client = await database().connect()
  try {
    await client.query('BEGIN')
    const inserted = await client.query(
      `INSERT INTO paddle_webhook_events(event_id,event_type,occurred_at,payload)
       VALUES($1,$2,$3,$4) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,
      [payload.event_id, payload.event_type, payload.occurred_at, payload],
    )
    await client.query('COMMIT')
    // The event is deliberately only recorded at this stage. Package
    // activation/granting will be added behind a payment-order contract and
    // must never happen before a verified, idempotent payment transition.
    return { received: true, duplicate: inserted.rowCount === 0 }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
})

