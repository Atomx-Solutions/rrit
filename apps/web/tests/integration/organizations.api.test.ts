import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { createError } from 'h3'
import { setTenantContext } from '../../server/utils/database'
import { isolateMigrationSql } from '../migration-test-utils'

const env = fileURLToPath(new URL('../../../../.env', import.meta.url))
if (existsSync(env)) process.loadEnvFile(env)
const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!databaseUrl || !['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname))
  throw new Error('Organization API tests require a local PostgreSQL database.')
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''))

const schema = `rrit_organizations_${randomUUID().replaceAll('-', '')}`
const admin = new Pool({ connectionString: databaseUrl })
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` })
const createdUserIds: string[] = []
const createdOrganizationIds: string[] = []
const createdBusinessIds: string[] = []
let createdAuthSchema = false
let createdAuthUsersTable = false
type OrganizationResponse = {
  id: string
  name: string
  slug: string
  revision: number
  role: string
}
let createOrganization: (event: never) => Promise<OrganizationResponse>
let listOrganizations: (event: never) => Promise<OrganizationResponse[]>
let getOrganization: (event: never) => Promise<OrganizationResponse>
let updateOrganization: (event: never) => Promise<OrganizationResponse>
let createLegacyBusiness: (event: never) => Promise<unknown>
let withUserTransaction: <T>(
  userId: string,
  work: (client: {
    query: <Row = Record<string, unknown>>(
      query: string,
      values?: unknown[],
    ) => Promise<{ rows: Row[] }>
  }) => Promise<T>,
) => Promise<T>

type TestEvent = {
  context: { user: { id: string; name: string; email: string }; body?: unknown; id?: string; status?: number }
}

async function user() {
  const id = randomUUID()
  createdUserIds.push(id)
  await pool.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)', [
    id,
    `${id}@example.test`,
    JSON.stringify({ name: 'API tester' }),
  ])
  return { id, name: 'API tester', email: `${id}@example.test` }
}

function event(user: TestEvent['context']['user'], body?: unknown, id?: string) {
  return { context: { user, body, id } } as TestEvent
}

beforeAll(async () => {
  // The runtime helper creates its own pg.Pool, so configure its connections
  // through the environment instead of relying on the test pool stub.
  vi.stubEnv('DATABASE_URL', databaseUrl)
  vi.stubEnv('PGOPTIONS', `-c search_path="${schema}",public`)
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('defineEventHandler', (handler: (event: never) => Promise<unknown>) => handler)
  vi.stubGlobal('requireUser', async (current: TestEvent) => current.context.user)
  vi.stubGlobal('requireSameOrigin', () => undefined)
  vi.stubGlobal('boundedBody', async (current: TestEvent) => current.context.body)
  vi.stubGlobal('getRouterParam', (current: TestEvent) => current.context.id)
  vi.stubGlobal('setResponseStatus', (current: TestEvent, status: number) => {
    current.context.status = status
  })
  vi.stubGlobal('setHeader', () => undefined)
  vi.stubGlobal('database', () => pool)
  vi.stubGlobal('deviceIdentity', () => 'organization-api-test-device')
  vi.stubGlobal('grantTrial', async () => undefined)
  vi.stubGlobal('loadWorkspace', async (_client: unknown, id: string) => ({
    id,
    slug: 'legacy-workspace',
    workspace: {},
  }))
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
  await admin.query(`CREATE SCHEMA "${schema}"`)
  const migrations = new URL('../../database/migrations/', import.meta.url)
  for (const file of (await readdir(migrations)).filter((file) => file.endsWith('.sql')).sort())
    await pool.query(
      isolateMigrationSql(await readFile(new URL(file, migrations), 'utf8'), schema),
    )
  createOrganization = (await import('../../server/api/v1/organizations/index.post')).default
  listOrganizations = (await import('../../server/api/v1/organizations/index.get')).default
  getOrganization = (await import('../../server/api/v1/organizations/[id].get')).default
  updateOrganization = (await import('../../server/api/v1/organizations/[id].patch')).default
  createLegacyBusiness = (await import('../../server/api/business.post')).default
  withUserTransaction = (await import('../../server/utils/database')).withUserTransaction
})

afterAll(async () => {
  await pool.end()
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`)
  if (createdUserIds.length)
    await admin.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [createdUserIds])
  if (createdAuthUsersTable) await admin.query('DROP TABLE auth.users CASCADE')
  if (createdAuthSchema) await admin.query('DROP SCHEMA auth CASCADE')
  await admin.end()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('organization HTTP handlers', () => {
  it('keeps legacy business onboarding compatible by creating its organization bridge', async () => {
    const owner = await user()
    const result = await createLegacyBusiness(
      event(owner, {
        name: 'Legacy Bridge Business',
        city: 'Tirana',
        industry: 'Services',
        description: 'A legacy onboarding flow that remains compatible.',
        voice: 'Clear and helpful',
      }) as never,
    )
    const businessId = (result as { id: string }).id
    createdBusinessIds.push(businessId)
    createdOrganizationIds.push(businessId)

    const bridge = await pool.query(
      `SELECT organization.id AS organization_id, member.user_id, member.role
       FROM businesses AS business
       JOIN organizations AS organization ON organization.id=business.id
       JOIN organization_memberships AS member ON member.organization_id=organization.id
       WHERE business.id=$1`,
      [businessId],
    )
    expect(bridge.rows).toEqual([
      { organization_id: businessId, user_id: owner.id, role: 'owner' },
    ])
  })

  it('sets the authenticated user context for the runtime database connection', async () => {
    const owner = await user()
    await expect(
      withUserTransaction(owner.id, async (client) => {
        const result = await client.query(
          "SELECT current_database() AS database_name, current_schema() AS schema_name, current_user AS role_name, app.current_user_id()::text AS user_id, pg_has_role(current_user,'app_runtime','MEMBER') AS runtime_member",
        )
        return result.rows[0]!
      }),
    ).resolves.toEqual({
      database_name: databaseName,
      schema_name: schema,
      role_name: 'app_runtime',
      user_id: owner.id,
      runtime_member: true,
    })
  })

  it('allows the runtime connection to insert when owner and user context match', async () => {
    const owner = await user()
    const id = randomUUID()
    const result = await withUserTransaction(owner.id, async (client) => {
      await setTenantContext(client as never, { userId: owner.id, organizationId: id })
      await client.query(
        "INSERT INTO organizations(id,name,slug,created_by) VALUES($1,'Runtime probe',$2,$3)",
        [id, `runtime-probe-${randomUUID().slice(0, 8)}`, owner.id],
      )
      await client.query(
        "INSERT INTO organization_memberships(organization_id,user_id,role,brand_scope) VALUES($1,$2,'owner','ALL_BRANDS')",
        [id, owner.id],
      )
      return { id }
    })
    createdOrganizationIds.push(result.id)
    expect(result.id).toBe(id)
  })

  it('creates a validated organization with an owner membership', async () => {
    const owner = await user()
    const current = event(owner, { name: 'API Organization', slug: `api-org-${randomUUID().slice(0, 8)}` })

    const result = await createOrganization(current as never)
    createdOrganizationIds.push(result.id)

    expect(current.context.status).toBe(201)
    expect(result).toMatchObject({ name: 'API Organization', role: 'owner', revision: 0 })
  })

  it('returns 422 for an invalid organization slug', async () => {
    const owner = await user()
    await expect(
      createOrganization(event(owner, { name: 'API Organization', slug: 'Invalid slug' }) as never),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('returns 422 for an invalid organization name', async () => {
    const owner = await user()
    await expect(
      createOrganization(event(owner, { name: 'Bad\u0001Name', slug: `invalid-name-${randomUUID().slice(0, 8)}` }) as never),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('returns 409 for a duplicate organization slug', async () => {
    const firstOwner = await user()
    const secondOwner = await user()
    const slug = `duplicate-${randomUUID().slice(0, 8)}`
    const first = await createOrganization(event(firstOwner, { name: 'First organization', slug }) as never)
    createdOrganizationIds.push(first.id)

    await expect(
      createOrganization(event(secondOwner, { name: 'Second organization', slug }) as never),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('does not list, read, or update Organization A for Organization B', async () => {
    const ownerA = await user()
    const ownerB = await user()
    const createA = event(ownerA, {
      name: 'Organization A',
      slug: `api-org-a-${randomUUID().slice(0, 8)}`,
    })
    const organizationA = await createOrganization(createA as never)
    createdOrganizationIds.push(organizationA.id)
    const organizationB = await createOrganization(
      event(ownerB, { name: 'Organization B', slug: `api-org-b-${randomUUID().slice(0, 8)}` }) as never,
    )
    createdOrganizationIds.push(organizationB.id)

    await expect(listOrganizations(event(ownerB) as never)).resolves.toEqual([
      expect.objectContaining({ id: organizationB.id }),
    ])
    await expect(getOrganization(event(ownerB, undefined, organizationA.id) as never)).rejects.toMatchObject({
      statusCode: 404,
    })
    await expect(
      updateOrganization(
        event(ownerB, { name: 'Forbidden', revision: organizationA.revision }, organizationA.id) as never,
      ),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('updates an organization for its owner', async () => {
    const owner = await user()
    const organization = await createOrganization(
      event(owner, { name: 'Organization update', slug: `api-update-${randomUUID().slice(0, 8)}` }) as never,
    )
    createdOrganizationIds.push(organization.id)

    await expect(
      updateOrganization(
        event(owner, { name: 'Organization updated', revision: organization.revision }, organization.id) as never,
      ),
    ).resolves.toMatchObject({ name: 'Organization updated', revision: 1, role: 'owner' })
  })

  it('updates an organization for an active admin', async () => {
    const owner = await user()
    const admin = await user()
    const organization = await createOrganization(
      event(owner, { name: 'Admin update', slug: `admin-update-${randomUUID().slice(0, 8)}` }) as never,
    )
    createdOrganizationIds.push(organization.id)
    await pool.query(
      "INSERT INTO organization_memberships(organization_id,user_id,role,brand_scope,status) VALUES($1,$2,'admin','ALL_BRANDS','active')",
      [organization.id, admin.id],
    )

    await expect(
      updateOrganization(
        event(admin, { name: 'Updated by admin', revision: organization.revision }, organization.id) as never,
      ),
    ).resolves.toMatchObject({ name: 'Updated by admin', revision: 1, role: 'admin' })
  })
})
