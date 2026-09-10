import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Pool, type PoolClient } from 'pg'
import { setTenantContext } from '../../../server/utils/database'
import type { TenantFixture } from './fixtures'

export type RlsHarness = {
  admin: Pool
  unrestricted: Pool
  schema: string
  trackUserId(userId: string): void
  asTenant<T>(tenant: TenantFixture, work: (client: PoolClient) => Promise<T>): Promise<T>
  withoutTenantContext<T>(work: (client: PoolClient) => Promise<T>): Promise<T>
  withAdminTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T>
  setRuntimeContext(client: PoolClient, tenant: TenantFixture): Promise<void>
  cleanup(): Promise<void>
}

const rootEnv = fileURLToPath(new URL('../../../../../.env', import.meta.url))

function databaseUrl() {
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)
  const value = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
  if (!value || !['127.0.0.1', 'localhost'].includes(new URL(value).hostname)) {
    throw new Error(
      'The RLS harness accepts only a local PostgreSQL connection. It never runs migrations against Supabase.',
    )
  }
  return value
}

function quotedIdentifier(value: string) {
  if (!/^rrit_rls_[a-f0-9]{32}$/.test(value)) throw new Error('Unsafe RLS test schema')
  return `"${value}"`
}

export async function createRlsHarness(): Promise<RlsHarness> {
  const connectionString = databaseUrl()
  const schema = `rrit_rls_${randomUUID().replaceAll('-', '')}`
  const quotedSchema = quotedIdentifier(schema)
  const admin = new Pool({ connectionString })
  const unrestricted = new Pool({
    connectionString,
    options: `-c search_path=${schema},public`,
  })
  const createdUserIds: string[] = []
  let createdAuthSchema = false
  let createdAuthUsersTable = false

  const authSchema = await admin.query("SELECT 1 FROM pg_namespace WHERE nspname = 'auth'")
  if (!authSchema.rowCount) {
    await admin.query('CREATE SCHEMA auth')
    createdAuthSchema = true
  }
  const authUsers = await admin.query(
    "SELECT 1 FROM pg_class WHERE relnamespace = 'auth'::regnamespace AND relname = 'users'",
  )
  if (!authUsers.rowCount) {
    await admin.query(`
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY,
        email text,
        raw_user_meta_data jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    createdAuthUsersTable = true
  }
  await admin.query(`CREATE SCHEMA ${quotedSchema}`)
  const migrations = new URL('../../../database/migrations/', import.meta.url)
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort())
    await unrestricted.query(await readFile(new URL(file, migrations), 'utf8'))

  async function withAdminTransaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await admin.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SET LOCAL search_path TO ${quotedSchema}, public`)
      const result = await work(client)
      await client.query('ROLLBACK')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async function setRuntimeContext(client: PoolClient, tenant: TenantFixture) {
    await client.query('SET LOCAL ROLE app_runtime')
    await client.query(`SET LOCAL search_path TO ${quotedSchema}, public`)
    await setTenantContext(client, { userId: tenant.userId, organizationId: tenant.organizationId })
  }

  async function asTenant<T>(tenant: TenantFixture, work: (client: PoolClient) => Promise<T>) {
    return await withAdminTransaction(async (client) => {
      await setRuntimeContext(client, tenant)
      return await work(client)
    })
  }

  async function withoutTenantContext<T>(work: (client: PoolClient) => Promise<T>) {
    return await withAdminTransaction(async (client) => {
      await client.query('SET LOCAL ROLE app_runtime')
      return await work(client)
    })
  }

  async function cleanup() {
    await unrestricted.end()
    await admin.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
    if (createdUserIds.length)
      await admin.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [createdUserIds])
    if (createdAuthUsersTable) await admin.query('DROP TABLE auth.users CASCADE')
    if (createdAuthSchema) await admin.query('DROP SCHEMA auth CASCADE')
    await admin.end()
  }

  return {
    admin,
    unrestricted,
    schema,
    trackUserId: (userId) => createdUserIds.push(userId),
    asTenant,
    withoutTenantContext,
    withAdminTransaction,
    setRuntimeContext,
    cleanup,
  }
}
