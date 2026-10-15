import { describe, expect, it } from 'vitest'
import { createError } from 'h3'
import { databaseFailure } from '../../server/utils/database-failure'

describe('databaseFailure', () => {
  it('reports an unreachable database as temporarily unavailable', () => {
    for (const problem of [
      { code: '57014', message: 'canceling statement due to statement timeout' },
      { message: 'Connection terminated due to connection timeout' },
    ]) {
      expect(databaseFailure(problem, 'server.BUSINESS_NOT_SAVED')).toMatchObject({
        statusCode: 503,
        message: 'server.DATABASE_UNAVAILABLE',
      })
    }
  })

  it('keeps an error that already explains itself', () => {
    const explained = createError({ statusCode: 400, message: 'server.VALUES_INVALID' })
    expect(databaseFailure(explained, 'server.BUSINESS_NOT_SAVED')).toBe(explained)
  })

  it('falls back to the action message for anything else', () => {
    expect(databaseFailure({ code: '23514', message: 'check violation' }, 'server.BUSINESS_NOT_SAVED')).toMatchObject({
      statusCode: 500,
      message: 'server.BUSINESS_NOT_SAVED',
    })
  })
})
