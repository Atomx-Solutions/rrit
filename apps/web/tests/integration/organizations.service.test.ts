import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { createError } from 'h3'
import {
  createOrganizationForUser,
  ensureOrganizationForLegacyBusiness,
  getOrganizationForUser,
  listOrganizationsForUser,
  updateOrganizationForUser,
} from '../../server/utils/organizations'
import { isolateMigrationSql } from '../migration-test-utils'

const env = fileURLToPath(new URL('../../../../.env', import.meta.url))
if (existsSync(env)) process.loadEnvFile(env)
const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!databaseUrl || !['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname))
  throw new Error('Organization integration tests require a local PostgreSQL database.')

const schema = `rrit_organizations_${randomUUID().replaceAll('-', '')}`
const admin = new Pool({ connectionString: databaseUrl })
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` })
const createdUserIds: string[] = []
let createdAuthSchema = false
let createdAuthUsersTable = false

async function user() {
  const id = randomUUID()
  createdUserIds.push(id)
  await pool.query(
    'INSERT INTO auth.users (id,email,raw_user_meta_data) VALUES ($1,$2,$3)',
    [id, `${id}@example.test`, JSON.stringify({ name: 'Organization tester' })],
  )
  return id
}

beforeAll(async () => {
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('database', () => pool)
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
})

describe('organizations schema', () => {
  it('rejects an organization that has no owner membership at commit', async () => {
    const ownerId = await user()
    await expect(
      pool.query(
        "INSERT INTO organizations(id,name,slug,created_by) VALUES($1,'Organization A','organization-a',$2)",
        [randomUUID(), ownerId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects deletion or demotion of the designated Owner membership', async () => {
    const ownerId = await user()
    const organization = await createOrganizationForUser(
      ownerId,
      { name: 'Invariant Organization', slug: `invariant-${randomUUID().slice(0, 8)}` },
      pool,
    )

    await expect(
      pool.query("UPDATE organization_memberships SET role='admin' WHERE organization_id=$1 AND user_id=$2", [
        organization.id,
        ownerId,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      pool.query('DELETE FROM organization_memberships WHERE organization_id=$1 AND user_id=$2', [
        organization.id,
        ownerId,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('organization application services', () => {
  it('bridges a legacy business to an organization and owner membership in its transaction', async () => {
    const ownerId = await user()
    const businessId = randomUUID()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('INSERT INTO businesses(id,owner_id,slug,state) VALUES($1,$2,$3,$4)', [
        businessId,
        ownerId,
        `legacy-${businessId.slice(0, 8)}`,
        JSON.stringify({}),
      ])
      await ensureOrganizationForLegacyBusiness(client, {
        businessId,
        userId: ownerId,
        name: 'Legacy Business Organization',
        slug: `legacy-${businessId.slice(0, 8)}`,
      })
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }

    const bridge = await pool.query(
      `SELECT organization.id AS organization_id, organization.created_by, member.role, member.status
       FROM businesses AS business
       JOIN organizations AS organization ON organization.id=business.id
       JOIN organization_memberships AS member ON member.organization_id=organization.id
       WHERE business.id=$1 AND member.user_id=$2`,
      [businessId, ownerId],
    )
    expect(bridge.rows).toEqual([
      {
        organization_id: businessId,
        created_by: ownerId,
        role: 'owner',
        status: 'active',
      },
    ])
  })

  it('creates an organization and its owner membership atomically', async () => {
    const ownerId = await user()
    const organization = await createOrganizationForUser(
      ownerId,
      { name: 'Organization A', slug: 'organization-a' },
      pool,
    )

    expect(organization).toMatchObject({
      name: 'Organization A',
      slug: 'organization-a',
      role: 'owner',
      revision: 0,
    })
    expect(
      (
        await pool.query(
          "SELECT role,status FROM organization_memberships WHERE organization_id=$1 AND user_id=$2",
          [organization.id, ownerId],
        )
      ).rows,
    ).toEqual([{ role: 'owner', status: 'active' }])
  })

  it('rolls back the organization when Owner membership creation fails', async () => {
    const ownerId = await user()
    const slug = `rollback-${randomUUID().slice(0, 8)}`
    await pool.query(`
      CREATE FUNCTION reject_test_owner_membership()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'test owner membership failure' USING ERRCODE = 'P0001';
      END
      $$
    `)
    await pool.query(`
      CREATE TRIGGER reject_test_owner_membership
      BEFORE INSERT ON organization_memberships
      FOR EACH ROW EXECUTE FUNCTION reject_test_owner_membership()
    `)

    try {
      await expect(
        createOrganizationForUser(ownerId, { name: 'Rollback Organization', slug }, pool),
      ).rejects.toMatchObject({ code: 'P0001' })
    } finally {
      await pool.query('DROP TRIGGER reject_test_owner_membership ON organization_memberships')
    }

    expect((await pool.query('SELECT id FROM organizations WHERE slug=$1', [slug])).rows).toEqual([])
  })

  it('lists only active memberships and hides another organization by id', async () => {
    const ownerA = await user()
    const ownerB = await user()
    const organizationA = await createOrganizationForUser(
      ownerA,
      { name: 'Organization A', slug: `organization-a-${randomUUID().slice(0, 8)}` },
      pool,
    )
    await createOrganizationForUser(
      ownerB,
      { name: 'Organization B', slug: `organization-b-${randomUUID().slice(0, 8)}` },
      pool,
    )

    await expect(listOrganizationsForUser(ownerA, pool)).resolves.toEqual([
      expect.objectContaining({ id: organizationA.id, role: 'owner' }),
    ])
    await expect(getOrganizationForUser(ownerB, organizationA.id, pool)).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('allows an owner to update and rejects an active non-admin member', async () => {
    const ownerId = await user()
    const memberId = await user()
    const organization = await createOrganizationForUser(
      ownerId,
      { name: 'Organization update', slug: `organization-update-${randomUUID().slice(0, 8)}` },
      pool,
    )
    await pool.query(
      "INSERT INTO organization_memberships(organization_id,user_id,role,brand_scope,status) VALUES($1,$2,'marketer','ALL_BRANDS','active')",
      [organization.id, memberId],
    )

    await expect(
      updateOrganizationForUser(
        memberId,
        organization.id,
        { name: 'Forbidden update', revision: organization.revision },
        pool,
      ),
    ).rejects.toMatchObject({ statusCode: 404 })
    await expect(
      updateOrganizationForUser(
        ownerId,
        organization.id,
        { name: 'Organization updated', revision: organization.revision },
        pool,
      ),
    ).resolves.toMatchObject({ name: 'Organization updated', revision: 1, role: 'owner' })
  })
})
