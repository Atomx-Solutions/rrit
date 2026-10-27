import { EventEmitter } from 'node:events'
import type pg from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { guardConnectionErrors } from '../../server/utils/database'

afterEach(() => vi.restoreAllMocks())

describe('a database connection closed while in use', () => {
  it('is logged instead of raising an uncaught error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const pool = new EventEmitter()
    guardConnectionErrors(pool as unknown as pg.Pool, 'Test pool')
    // A checked-out connection has no pool listener, as in pg-pool.
    const client = new EventEmitter()
    pool.emit('connect', client)
    const closed = Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' })
    expect(() => client.emit('error', closed)).not.toThrow()
    expect(warn).toHaveBeenCalledWith('Test pool lost a database connection in use.', { code: 'ECONNRESET' })
  })

  it('would be uncaught without the guard', () => {
    const client = new EventEmitter()
    expect(() => client.emit('error', new Error('Connection terminated unexpectedly'))).toThrow()
  })
})
