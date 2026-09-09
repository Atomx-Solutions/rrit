import pg from 'pg'
import type { PoolClient } from 'pg'
let pool: pg.Pool | undefined
export function database() {
  const workerProcess = ['publisher', 'maintenance'].includes(process.env.PROCESS_ROLE || '')
  const connectionString = workerProcess
    ? process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL
    : process.env.DATABASE_URL
  if (!connectionString)
    throw createError({ statusCode: 503, message: 'Ruajtja në server ende nuk është konfiguruar.' })
  return (pool ||= new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  }))
}

export type TenantContext = {
  userId: string
  organizationId: string
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
  const client = await database().connect()
  try {
    await client.query('BEGIN')
    await setTenantContext(client, context)
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function withUserTransaction<T>(
  userId: string,
  work: (client: PoolClient) => Promise<T>,
) {
  const client = await database().connect()
  try {
    await client.query('BEGIN')
    await setUserContext(client, userId)
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
