import { describe, expect, it } from 'vitest'
import { clientSelfServiceDisabled } from '../../server/utils/client-billing-policy'

describe('client billing policy', () => {
  it('rejects all client self-service purchase requests', () => {
    try {
      clientSelfServiceDisabled()
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 403,
        data: { code: 'CLIENT_SELF_SERVICE_DISABLED' },
      })
      return
    }
    throw new Error('Expected self-service purchase to be rejected')
  })
})
