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

export function paddleApiKey() {
  return process.env.PADDLE_API_KEY?.trim() || null
}

export function paddleApiBaseUrl() {
  return (process.env.PADDLE_ENV || 'sandbox') === 'production'
    ? 'https://api.paddle.com'
    : 'https://sandbox-api.paddle.com'
}

export async function createPaddleTransaction(input: {
  amountCents: number
  currency: string
  description: string
  customData: Record<string, string>
}) {
  const apiKey = paddleApiKey()
  if (!apiKey) throw new Error('PADDLE_API_KEY is not configured')
  const response = await fetch(`${paddleApiBaseUrl()}/transactions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collection_mode: 'automatic',
      items: [{
        quantity: 1,
        price: {
          description: input.description,
          billing_cycle: { interval: 'month', frequency: 1 },
          tax_mode: 'account_setting',
          unit_price: { amount: String(input.amountCents), currency_code: input.currency },
        },
      }],
      custom_data: input.customData,
    }),
  })
  const payload = await response.json().catch(() => null) as { data?: { id?: string }; error?: { detail?: string } } | null
  if (!response.ok || !payload?.data?.id)
    throw new Error(payload?.error?.detail || `Paddle transaction failed (${response.status})`)
  return payload.data.id
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

