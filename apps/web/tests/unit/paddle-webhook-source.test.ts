import { afterEach, describe, expect, it, vi } from 'vitest'
import { paddleWebhookSourceAllowed } from '../../server/utils/paddle'

const originalVercel = process.env.VERCEL
const originalPaddleEnv = process.env.PADDLE_ENV

afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL
  else process.env.VERCEL = originalVercel
  if (originalPaddleEnv === undefined) delete process.env.PADDLE_ENV
  else process.env.PADDLE_ENV = originalPaddleEnv
  vi.unstubAllGlobals()
})

describe('Paddle webhook source allowlist', () => {
  it('fetches live IPs and rejects unknown Vercel sources', async () => {
    process.env.VERCEL = '1'
    process.env.PADDLE_ENV = 'production'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: { ipv4_cidrs: ['203.0.113.10/32'] },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await paddleWebhookSourceAllowed(undefined)).toBe(false)
    expect(await paddleWebhookSourceAllowed('198.51.100.8')).toBe(false)
    expect(await paddleWebhookSourceAllowed('203.0.113.10')).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('https://api.paddle.com/ips', expect.any(Object))
  })
})
