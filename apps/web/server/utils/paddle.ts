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

export function paddleProductId() {
  return process.env.PADDLE_PRODUCT_ID?.trim() || null
}

export function paddlePackagePriceId() {
  return process.env.PADDLE_PACKAGE_PRICE_ID?.trim() || null
}

let paddleTaxCategoryCache: { productId: string; taxCategory: string } | null = null

export async function createPaddleTransaction(input: {
  amountCents: number
  currency: string
  description: string
  name: string
  recurring: boolean
  quantity?: number
  unitAmountCents?: number
  customData: Record<string, string>
}) {
  const apiKey = paddleApiKey()
  if (!apiKey) throw new Error('PADDLE_API_KEY is not configured')
  let productId = paddleProductId()
  // A price ID is commonly configured while setting up Paddle. Inline prices
  // require the parent product ID, so resolve it instead of sending `pri_...`
  // as `product_id` (which Paddle rejects).
  const configuredPriceId = paddlePackagePriceId()
  if (!productId || productId.startsWith('pri_')) {
    const priceId = productId?.startsWith('pri_') ? productId : configuredPriceId
    if (priceId) {
      const priceResponse = await fetch(`${paddleApiBaseUrl()}/prices/${encodeURIComponent(priceId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      const pricePayload = await priceResponse.json().catch(() => null) as {
        data?: { product_id?: string }
      } | null
      productId = pricePayload?.data?.product_id || null
    }
  }
  if (!productId || !/^pro_[a-z\d]{26}$/.test(productId))
    throw new Error('PADDLE_PRODUCT_ID must be a Paddle product ID (pro_...) or a valid PADDLE_PACKAGE_PRICE_ID must be configured')
  // An inline price with product_id still displays the catalog product name.
  // Carry its tax category into a transaction-specific product instead.
  let taxCategory = paddleTaxCategoryCache?.productId === productId
    ? paddleTaxCategoryCache.taxCategory
    : null
  if (!taxCategory) {
    const productResponse = await fetch(`${paddleApiBaseUrl()}/products/${encodeURIComponent(productId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const productPayload = await productResponse.json().catch(() => null) as {
      data?: { tax_category?: string }
    } | null
    taxCategory = productPayload?.data?.tax_category || null
    if (!productResponse.ok || !taxCategory)
      throw new Error(`Could not resolve Paddle product tax category (${productResponse.status})`)
    paddleTaxCategoryCache = { productId, taxCategory }
  }
  const response = await fetch(`${paddleApiBaseUrl()}/transactions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collection_mode: 'automatic',
      currency_code: input.currency,
      items: [{
        quantity: input.quantity ?? 1,
        price: {
          description: input.description,
          name: input.recurring ? 'Monthly' : 'One-time',
          product: { name: input.name, description: input.description, tax_category: taxCategory },
          // A package is one negotiated bundle. Quantity must not duplicate the
          // whole bundle; changing included videos/posts requires a new offer.
          quantity: {
            minimum: input.quantity ?? 1,
            maximum: input.quantity ?? 1,
          },
          billing_cycle: input.recurring ? { interval: 'month', frequency: 1 } : null,
          tax_mode: 'account_setting',
          unit_price: {
            amount: String(input.unitAmountCents ?? input.amountCents),
            currency_code: input.currency,
          },
        },
      }],
      custom_data: input.customData,
    }),
  })
  const payload = await response.json().catch(() => null) as {
    data?: { id?: string }
    error?: { detail?: string; errors?: Array<{ field?: string; message?: string }> }
  } | null
  if (!response.ok || !payload?.data?.id) {
    const fields = payload?.error?.errors
      ?.map(item => [item.field, item.message].filter(Boolean).join(': '))
      .filter(Boolean)
      .join('; ')
    throw new Error(fields || payload?.error?.detail || `Paddle transaction failed (${response.status})`)
  }
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

