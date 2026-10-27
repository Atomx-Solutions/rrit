import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decryptInstagramToken,
  encryptInstagramToken,
  instagramAuthorizeUrl,
  instagramConfigured,
  instagramScopes,
  instagramTokenNeedsRefresh,
} from '../../server/utils/instagram'

const day = 24 * 60 * 60 * 1000

function configure() {
  vi.stubEnv('APP_URL', 'https://framic.test')
  vi.stubEnv('INSTAGRAM_APP_ID', 'instagram-app')
  vi.stubEnv('INSTAGRAM_APP_SECRET', 'instagram-secret')
  vi.stubEnv('INSTAGRAM_REDIRECT_URI', 'https://framic.test/api/instagram/callback')
  vi.stubEnv('META_GRAPH_VERSION', 'v26.0')
  vi.stubEnv('META_TOKEN_KEY', Buffer.alloc(32, 7).toString('base64'))
}

afterEach(() => vi.unstubAllEnvs())

describe('Instagram Login', () => {
  it('is not configured without its own app credentials', () => {
    configure()
    vi.stubEnv('INSTAGRAM_APP_ID', '')
    expect(instagramConfigured()).toBe(false)
  })

  it('rejects a callback outside the application origin', () => {
    configure()
    vi.stubEnv('INSTAGRAM_REDIRECT_URI', 'https://elsewhere.test/api/instagram/callback')
    expect(instagramConfigured()).toBe(false)
  })

  it('authorizes on instagram.com with the publishing scopes', () => {
    configure()
    const url = new URL(instagramAuthorizeUrl('state-value'))
    expect(url.origin).toBe('https://www.instagram.com')
    expect(url.searchParams.get('client_id')).toBe('instagram-app')
    expect(url.searchParams.get('redirect_uri')).toBe('https://framic.test/api/instagram/callback')
    expect(url.searchParams.get('scope')).toBe(instagramScopes.join(','))
    expect(url.searchParams.get('state')).toBe('state-value')
  })

  it('binds an encrypted token to its business', () => {
    configure()
    const envelope = encryptInstagramToken('token', 'business-a')
    expect(decryptInstagramToken(envelope, 'business-a')).toBe('token')
    expect(() => decryptInstagramToken(envelope, 'business-b')).toThrow()
  })

  it('refreshes a token close to expiry once it is a day old', () => {
    const now = Date.now()
    expect(instagramTokenNeedsRefresh(new Date(now + 5 * day), new Date(now - 2 * day), now)).toBe(true)
    expect(instagramTokenNeedsRefresh(new Date(now + 5 * day), new Date(now - day / 2), now)).toBe(false)
    expect(instagramTokenNeedsRefresh(new Date(now + 50 * day), new Date(now - 2 * day), now)).toBe(false)
  })
})
