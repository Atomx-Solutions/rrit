import { afterEach, describe, expect, it, vi } from 'vitest'
import { ipv4Range, paddleApiBaseUrl, paddleEnvironment, paddleWebhookSourceAllowed } from '../../server/utils/paddle'

const originalVercel = process.env.VERCEL
const originalPaddleEnv = process.env.PADDLE_ENV

afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL
  else process.env.VERCEL = originalVercel
  if (originalPaddleEnv === undefined) delete process.env.PADDLE_ENV
  else process.env.PADDLE_ENV = originalPaddleEnv
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const ipsResponse = (cidrs: string[]) => new Response(JSON.stringify({ data: { ipv4_cidrs: cidrs } }), { status: 200 })

describe('Paddle webhook source allowlist', () => {
  it('fetches live IPs and rejects unknown Vercel sources', async () => {
    process.env.VERCEL = '1'
    process.env.PADDLE_ENV = 'production'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn(async () => ipsResponse(['203.0.113.10/32']))
    vi.stubGlobal('fetch', fetchMock)

    expect(await paddleWebhookSourceAllowed(undefined)).toBe(false)
    expect(await paddleWebhookSourceAllowed('198.51.100.8')).toBe(false)
    expect(await paddleWebhookSourceAllowed('203.0.113.10')).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('https://api.paddle.com/ips', expect.any(Object))
  })

  it('accepts an address inside a published range, not only single addresses', async () => {
    process.env.VERCEL = '1'
    process.env.PADDLE_ENV = 'sandbox'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => ipsResponse(['192.0.2.0/28'])))

    expect(await paddleWebhookSourceAllowed('192.0.2.9')).toBe(true)
    expect(await paddleWebhookSourceAllowed('192.0.2.16')).toBe(false)
  })

  it('keeps the last list when Paddle cannot be reached, and logs it', async () => {
    process.env.VERCEL = '1'
    process.env.PADDLE_ENV = 'production'
    vi.useFakeTimers({ toFake: ['Date'] })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => ipsResponse(['203.0.113.20/32'])))
    expect(await paddleWebhookSourceAllowed('203.0.113.20')).toBe(true)

    vi.setSystemTime(Date.now() + 60 * 60 * 1000)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    expect(await paddleWebhookSourceAllowed('203.0.113.20')).toBe(true)
    expect(errors).toHaveBeenCalledWith('Paddle webhook IP list could not be loaded', expect.any(Error))
  })

  it('logs why a source was turned away', async () => {
    process.env.VERCEL = '1'
    process.env.PADDLE_ENV = 'production'
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => ipsResponse(['203.0.113.20/32'])))

    expect(await paddleWebhookSourceAllowed('2001:db8::1')).toBe(false)
    expect(await paddleWebhookSourceAllowed('198.51.100.8')).toBe(false)
    expect(errors.mock.calls.map(call => String(call[0]))).toEqual([
      expect.stringContaining('not an IPv4 address'),
      expect.stringContaining('198.51.100.8 is not a published Paddle address'),
    ])
  })
})

describe('IPv4 ranges', () => {
  it('reads addresses and ranges and rejects anything else', () => {
    expect(ipv4Range('203.0.113.10/32')).toEqual({ network: 0xCB00710A, mask: 0xFFFFFFFF })
    expect(ipv4Range('192.0.2.7/24')).toEqual({ network: 0xC0000200, mask: 0xFFFFFF00 })
    expect(ipv4Range('192.0.2.7')).toEqual({ network: 0xC0000207, mask: 0xFFFFFFFF })
    expect(ipv4Range('300.0.0.1/32')).toBeNull()
    expect(ipv4Range('192.0.2.0/33')).toBeNull()
    expect(ipv4Range('2001:db8::/32')).toBeNull()
  })
})

describe('Paddle environment', () => {
  it('is live only for exactly "production", and the API follows it', () => {
    for (const [value, environment] of [['production', 'production'], [undefined, 'sandbox'], ['', 'sandbox'], ['prod', 'sandbox'], ['live', 'sandbox']] as const) {
      if (value === undefined) delete process.env.PADDLE_ENV
      else process.env.PADDLE_ENV = value
      expect(paddleEnvironment()).toBe(environment)
      expect(paddleApiBaseUrl()).toBe(environment === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com')
    }
  })
})
