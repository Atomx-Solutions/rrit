import { afterEach, describe, expect, it, vi } from 'vitest'
import { createError, type H3Event } from 'h3'
import { requireCronSecret } from '../../server/utils/cron-auth'

function call(authorization?: string) {
  vi.stubGlobal('getHeader', () => authorization)
  return () => requireCronSecret({ path: '/api/cron/maintenance' } as H3Event)
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('cron secret', () => {
  it('lets in only the bearer token Vercel Cron sends', () => {
    vi.stubGlobal('createError', createError)
    vi.stubEnv('CRON_SECRET', 'cron-secret-for-tests')
    expect(call('Bearer cron-secret-for-tests')).not.toThrow()
    expect(call('Bearer wrong-secret-for-tests')).toThrow(expect.objectContaining({ statusCode: 401 }))
    expect(call()).toThrow(expect.objectContaining({ statusCode: 401 }))
  })

  it('refuses every call while no secret is set', () => {
    vi.stubGlobal('createError', createError)
    vi.stubEnv('CRON_SECRET', '')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(call('Bearer ')).toThrow(expect.objectContaining({ statusCode: 401 }))
  })
})
