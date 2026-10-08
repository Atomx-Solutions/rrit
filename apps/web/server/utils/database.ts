import pg from 'pg'
import type { PoolClient } from 'pg'
let pool: pg.Pool | undefined
let operationsWorkerPool: pg.Pool | undefined
let operationsWorkerLeases = 0

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
  const worker = (operationsWorkerPool ||= new pg.Pool({
    connectionString,
    max: 6,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  }))
  if (operationsWorkerLeases === 0)
    worker.on('error', (error) => {
      console.warn('Operations pool discarded an interrupted idle connection.', {
        code:
          'code' in error && typeof error.code === 'string' ? error.code.slice(0, 64) : undefined,
      })
    })
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
) {
  const client = await connectRuntimeDatabase()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE app_runtime')
    await setUserContext(client, userId)
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
