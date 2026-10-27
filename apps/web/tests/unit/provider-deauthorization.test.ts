import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifySignedRequest } from '../../server/utils/provider-deauthorization'

function signed(payload: object, secret: string) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(body).digest('base64url')
  return `${signature}.${body}`
}

describe('Meta signed_request', () => {
  it('returns the person of a request signed with the app secret', () => {
    const request = signed({ algorithm: 'HMAC-SHA256', user_id: '1234', issued_at: 1 }, 'secret')
    expect(verifySignedRequest(request, 'secret')).toBe('1234')
  })

  it('rejects a request signed with another secret', () => {
    const request = signed({ algorithm: 'HMAC-SHA256', user_id: '1234' }, 'other')
    expect(verifySignedRequest(request, 'secret')).toBeNull()
  })

  it('rejects a payload changed after signing', () => {
    const [signature] = signed({ algorithm: 'HMAC-SHA256', user_id: '1234' }, 'secret').split('.')
    const forged = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '9999' })).toString('base64url')
    expect(verifySignedRequest(`${signature}.${forged}`, 'secret')).toBeNull()
  })

  it('rejects another algorithm or a missing person', () => {
    expect(verifySignedRequest(signed({ algorithm: 'none', user_id: '1' }, 'secret'), 'secret')).toBeNull()
    expect(verifySignedRequest(signed({ algorithm: 'HMAC-SHA256' }, 'secret'), 'secret')).toBeNull()
    expect(verifySignedRequest('malformed', 'secret')).toBeNull()
  })
})
