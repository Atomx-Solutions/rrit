import { createError, isError } from 'h3'

/**
 * Turns a database failure into an error the person can act on. Without this
 * every failure reaches the browser as a bare "Server Error", which says
 * nothing about whether to retry, wait or change what was typed.
 */
export function databaseFailure(error: unknown, fallbackMessage: string) {
  // Errors that already explain themselves pass through unchanged.
  if (isError(error)) return error
  const problem = error as { code?: string; message?: string }
  const message = problem.message?.toLowerCase() || ''
  const unavailable = problem.code === '57014'
    || problem.code === '57P01'
    || problem.code === '08006'
    || problem.code === '08001'
    || problem.code === 'ECONNREFUSED'
    || problem.code === 'ETIMEDOUT'
    || message.includes('connection terminated')
    || message.includes('connection timeout')
    || message.includes('timeout exceeded when trying to connect')
  if (unavailable)
    return createError({
      statusCode: 503,
      message: 'server.DATABASE_UNAVAILABLE',
      data: { code: 'DATABASE_UNAVAILABLE' },
    })
  console.error('Database request failed.', { code: problem.code, message: problem.message })
  return createError({ statusCode: 500, message: fallbackMessage, data: { code: problem.code || 'UNKNOWN' } })
}
