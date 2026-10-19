import { createHmac, timingSafeEqual } from 'node:crypto'

export type PaddleWebhookEnvelope = {
  event_id: string
  event_type: string
  occurred_at: string
  data: Record<string, unknown>
}

export function paddleEnabled() {
  return process.env.PADDLE_ENABLED === 'true'
}

export function paddleWebhookSecret() {
  return process.env.PADDLE_WEBHOOK_SECRET?.trim() || null
}

/** Verifies Paddle's ts:h1 signature against the raw request body. */
export function verifyPaddleSignature(rawBody: string, signature: string, secret: string) {
  const parts = Object.fromEntries(signature.split(';').map((part) => {
    const index = part.indexOf('=')
    return index === -1 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)]
  }))
  const timestamp = parts.ts
  const received = parts.h1
  if (!timestamp || !received || !/^\d+$/.test(timestamp)) return false

  const tolerance = Number(process.env.PADDLE_WEBHOOK_TOLERANCE_SECONDS || 300)
  if (!Number.isFinite(tolerance) || Math.abs(Date.now() / 1000 - Number(timestamp)) > tolerance)
    return false

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}:${rawBody}`)
    .digest('hex')
  const actual = Buffer.from(received, 'utf8')
  const calculated = Buffer.from(expected, 'utf8')
  return actual.length === calculated.length && timingSafeEqual(actual, calculated)
}

