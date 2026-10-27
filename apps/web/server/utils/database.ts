import pg from 'pg'
import type { PoolClient } from 'pg'
let pool: pg.Pool | undefined
let operationsWorkerPool: pg.Pool | undefined
let operationsWorkerLeases = 0

/**
 * Keeps a connection that Supabase closes from crashing the process.
 *
 * A pool listens for errors only on its idle connections: it drops that
 * listener while a connection is checked out. A socket closed mid-transaction
 * then emits an error nobody handles, which Node raises as an uncaught
 * exception. Every connection keeps a listener of its own instead; the query
 * in flight still fails and its transaction rolls back, and the pool removes
 * the broken connection when it is released.
 */
export function guardConnectionErrors(target: pg.Pool, label: string) {
  target.on('connect', (client) => {
    client.on('error', (error: Error & { code?: unknown }) => {
      console.warn(`${label} lost a database connection in use.`, {
        code: typeof error.code === 'string' ? error.code.slice(0, 64) : undefined,
      })
    })
  })
}

export function database() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString)
    throw createError({ statusCode: 503, message: 'server.SERVER_STORAGE_NOT_CONFIGURED' })
  if (!pool) {
    pool = new pg.Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
    })
    pool.on('error', (error) => {
      console.warn('Runtime database pool discarded an interrupted idle connection.', {
        code:
          'code' in error && typeof error.code === 'string' ? error.code.slice(0, 64) : undefined,
      })
    })
    guardConnectionErrors(pool, 'Runtime database pool')
  }
  return pool
}

// HTTP handlers must always use database(). Long-running operational plugins
// explicitly lease this separate pool so PROCESS_ROLE cannot elevate incoming
// requests to cross-tenant worker privileges.
export function acquireOperationsWorkerDatabase() {
  const connectionString = process.env.WORKER_DATABASE_URL
  if (!connectionString)
    throw createError({ statusCode: 503, message: 'server.WORKER_DATABASE_NOT_CONFIGURED' })
  const configuredTimeout = Number(process.env.WORKER_DATABASE_STATEMENT_TIMEOUT_MS || 60000)
  const statementTimeout = Number.isFinite(configuredTimeout)
    ? Math.min(Math.max(Math.trunc(configuredTimeout), 10000), 300000)
    : 60000
  const worker = (operationsWorkerPool ||= new pg.Pool({
    connectionString,
    max: 6,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: statementTimeout,
  }))
  if (operationsWorkerLeases === 0) {
    worker.on('error', (error) => {
      console.warn('Operations pool discarded an interrupted idle connection.', {
        code:
          'code' in error && typeof error.code === 'string' ? error.code.slice(0, 64) : undefined,
      })
    })
    guardConnectionErrors(worker, 'Operations pool')
  }
  operationsWorkerLeases += 1
  let released = false
  return {
    db: worker,
    async release() {
      if (released) return
      released = true
      operationsWorkerLeases -= 1
      if (operationsWorkerLeases === 0 && operationsWorkerPool === worker) {
        operationsWorkerPool = undefined
        await worker.end()
      }
    },
  }
}

export type TenantContext = {
  userId: string
  organizationId: string
}

async function connectRuntimeDatabase() {
  let lastError: unknown
  for (const delay of [0, 200, 600]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      return await database().connect()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

export async function setTenantContext(client: PoolClient, context: TenantContext) {
  await client.query(
    "SELECT set_config('app.user_id',$1,true), set_config('app.organization_id',$2,true)",
    [context.userId, context.organizationId],
  )
}

export async function setUserContext(client: PoolClient, userId: string) {
  await client.query(
    "SELECT set_config('app.user_id',$1,true), set_config('app.organization_id','',true)",
    [userId],
  )
}

export async function withTenantTransaction<T>(
  context: TenantContext,
  work: (client: PoolClient) => Promise<T>,
) {
  const client = await connectRuntimeDatabase()
  try {
    await client.query('BEGIN')
    await setTenantContext(client, context)
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Do not hide the original failure when Supabase already closed the socket.
    }
    throw error
  } finally {
    client.release()
  }
}

export async function withUserTransaction<T>(
  userId: string,
  work: (client: PoolClient) => Promise<T>,
  onTiming?: (phase: string, durationMs: number) => void,
) {
  const timed = async <R>(phase: string, action: () => Promise<R>): Promise<R> => {
    if (!onTiming) return action()
    const startedAt = performance.now()
    try {
      return await action()
    } finally {
      // Diagnostic callbacks must not interrupt a transaction or hide its error.
      try { onTiming(phase, performance.now() - startedAt) } catch { /* diagnostics only */ }
    }
  }
  const client = await timed('connect', connectRuntimeDatabase)
  try {
    await timed('begin', () => client.query('BEGIN'))
    await timed('role', () => client.query('SET LOCAL ROLE app_runtime'))
    await timed('userContext', () => setUserContext(client, userId))
    const result = await work(client)
    await timed('commit', () => client.query('COMMIT'))
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Do not hide the original failure when Supabase already closed the socket.
    }
    throw error
  } finally {
    client.release()
  }
}
