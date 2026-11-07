import { createHmac, timingSafeEqual } from 'node:crypto'
import type { PaddlePackageLine } from './paddle-package-lines'

export type PaddleWebhookEnvelope = {
  event_id: string
  event_type: string
  occurred_at: string
  data: Record<string, unknown>
}

/** How long one Paddle API call may take before the request gives up on it. */
export const PADDLE_REQUEST_TIMEOUT_MS = 10_000
const paddleSignal = () => AbortSignal.timeout(PADDLE_REQUEST_TIMEOUT_MS)

export function paddleEnabled() {
  return process.env.PADDLE_ENABLED === 'true'
}

export function paddleWebhookSecret() {
  return process.env.PADDLE_WEBHOOK_SECRET?.trim() || null
}

export function paddleApiKey() {
  return process.env.PADDLE_API_KEY?.trim() || null
}

/** Live only when PADDLE_ENV is exactly "production"; anything else is sandbox. */
export function paddleEnvironment(): 'production' | 'sandbox' {
  return process.env.PADDLE_ENV === 'production' ? 'production' : 'sandbox'
}

export function paddleApiBaseUrl() {
  return paddleEnvironment() === 'production'
    ? 'https://api.paddle.com'
    : 'https://sandbox-api.paddle.com'
}

type Ipv4Range = { network: number; mask: number }
let paddleWebhookIps: { ranges: Ipv4Range[]; expiresAt: number; environment: string } | null = null
const PADDLE_IPS_TTL_MS = 5 * 60 * 1000
const PADDLE_IPS_TIMEOUT_MS = 3000
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function ipv4Number(value: string) {
  const parts = IPV4.exec(value)?.slice(1).map(Number)
  if (!parts || parts.some(part => part > 255)) return null
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
}

/** Parses "a.b.c.d/n" (or a bare address) into a range; anything else is null. */
export function ipv4Range(cidr: string): Ipv4Range | null {
  const [address = '', bits = '32'] = cidr.split('/')
  const network = ipv4Number(address)
  const length = /^\d{1,2}$/.test(bits) ? Number(bits) : NaN
  if (network === null || !(length >= 0 && length <= 32)) return null
  const mask = length === 0 ? 0 : (0xFFFFFFFF << (32 - length)) >>> 0
  return { network: (network & mask) >>> 0, mask }
}

async function fetchPaddleWebhookRanges() {
  try {
    const response = await fetch(`${paddleApiBaseUrl()}/ips`, { signal: AbortSignal.timeout(PADDLE_IPS_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`status ${response.status}`)
    const payload = await response.json() as { data?: { ipv4_cidrs?: string[] } }
    const ranges = (payload.data?.ipv4_cidrs || []).map(ipv4Range).filter((range): range is Ipv4Range => !!range)
    if (!ranges.length) throw new Error('no usable IPv4 ranges')
    return ranges
  } catch (error) {
    console.error('Paddle webhook IP list could not be loaded', error)
    return null
  }
}

/**
 * Vercel overwrites this header with the request's public source IP. Paddle's
 * published ranges are cached; when they cannot be reloaded the last list
 * stays in use, so a short Paddle outage does not turn paid webhooks away.
 */
export async function paddleWebhookSourceAllowed(forwardedFor: string | undefined) {
  if (process.env.VERCEL !== '1') return true
  const source = forwardedFor?.split(',')[0]?.trim()
  const address = source ? ipv4Number(source) : null
  if (address === null) {
    console.error(`Paddle webhook rejected: source "${source ?? ''}" is not an IPv4 address`)
    return false
  }

  const environment = paddleEnvironment()
  const cached = paddleWebhookIps?.environment === environment ? paddleWebhookIps : null
  if (!cached || Date.now() >= cached.expiresAt) {
    const ranges = await fetchPaddleWebhookRanges()
    if (ranges) paddleWebhookIps = { ranges, expiresAt: Date.now() + PADDLE_IPS_TTL_MS, environment }
    else if (!cached) return false
  }
  const allowed = paddleWebhookIps!.ranges.some(range => ((address & range.mask) >>> 0) === range.network)
  if (!allowed) console.error(`Paddle webhook rejected: ${source} is not a published Paddle address`)
  return allowed
}

export function paddleProductId() {
  return process.env.PADDLE_PRODUCT_ID?.trim() || null
}

export function paddlePackagePriceId() {
  return process.env.PADDLE_PACKAGE_PRICE_ID?.trim() || null
}

/**
 * The buyer as Paddle collected it at checkout, shaped like an invoice buyer.
 * Null when Paddle cannot be reached, so the invoice falls back to the
 * organization rather than holding up the payment.
 */
export async function paddleTransactionBuyer(transactionId: string) {
  const apiKey = paddleApiKey()
  if (!apiKey) return null
  try {
    const response = await fetch(
      `${paddleApiBaseUrl()}/transactions/${encodeURIComponent(transactionId)}?include=customer,address,business`,
      { headers: { Authorization: `Bearer ${apiKey}` }, signal: paddleSignal() },
    )
    if (!response.ok) return null
    const payload = await response.json() as {
      data?: {
        customer?: { name?: string | null; email?: string | null } | null
        address?: {
          first_line?: string | null; second_line?: string | null; postal_code?: string | null
          city?: string | null; region?: string | null; country_code?: string | null
        } | null
        business?: { name?: string | null; tax_identifier?: string | null } | null
      }
    }
    const { customer, address, business } = payload.data || {}
    const name = business?.name || customer?.name || customer?.email
    if (!name) return null
    return {
      name,
      address: [address?.first_line, address?.second_line].filter(Boolean).join(', '),
      city: [address?.postal_code, address?.city, address?.region].filter(Boolean).join(' '),
      country: address?.country_code || '',
      fiscalNumber: business?.tax_identifier || '',
    }
  } catch {
    return null
  }
}

let paddleTaxCategoryCache: { productId: string; taxCategory: string } | null = null

/** The price name Paddle shows under each line: a recurring or a one-off charge. */
const PADDLE_PRICE_NAMES = { recurring: 'Monthly', oneTime: 'One-time' } as const

export async function createPaddleTransaction(input: {
  currency: string
  recurring: boolean
  adjustableQuantity: boolean
  lineItems: PaddlePackageLine[]
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
        signal: paddleSignal(),
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
      signal: paddleSignal(),
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
    signal: paddleSignal(),
    body: JSON.stringify({
      collection_mode: 'automatic',
      currency_code: input.currency,
      items: input.lineItems.map(line => ({
        quantity: line.quantity,
        price: {
          description: line.description,
          name: input.recurring ? PADDLE_PRICE_NAMES.recurring : PADDLE_PRICE_NAMES.oneTime,
          product: { name: line.name, description: line.description, tax_category: taxCategory },
          quantity: {
            minimum: input.adjustableQuantity ? 1 : line.quantity,
            maximum: input.adjustableQuantity ? line.maximum : line.quantity,
          },
          billing_cycle: input.recurring ? { interval: 'month', frequency: 1 } : null,
          tax_mode: 'account_setting',
          unit_price: {
            amount: String(line.unitAmountCents),
            currency_code: input.currency,
          },
        },
      })),
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

