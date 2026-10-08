import type { Pool, PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import {
  organizationRoleSchema,
  organizationViewSchema,
  type OrganizationCreateInput,
  type OrganizationRole,
  type OrganizationUpdateInput,
  type OrganizationView,
} from '../../shared/schemas/organization'
import { setTenantContext, setUserContext, withUserTransaction } from './database'

type Membership = {
  organizationId: string
  role: OrganizationRole
}

async function withOrganizationUserTransaction<T>(
  userId: string,
  work: (client: PoolClient) => Promise<T>,
  db?: Pool,
) {
  if (!db) return await withUserTransaction(userId, work)
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE app_runtime')
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

function unavailableOrganization(): never {
  throw createError({ statusCode: 404, message: 'server.ORGANIZATION_NOT_FOUND' })
}

function duplicateSlug(error: unknown): never {
  if (typeof error === 'object' && error && 'code' in error && error.code === '23505')
    throw createError({ statusCode: 409, message: 'server.ORGANIZATION_SLUG_EXISTS' })
  throw error
}

function organizationFromRow(row: unknown): OrganizationView {
  return organizationViewSchema.parse(row)
}

async function membershipForUser(client: PoolClient, userId: string, organizationId: string) {
  const result = await client.query(
    "SELECT organization_id AS \"organizationId\", role FROM organization_memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",
    [organizationId, userId],
  )
  const row = result.rows[0]
  if (!row) unavailableOrganization()
  return {
    organizationId: row.organizationId as string,
    role: organizationRoleSchema.parse(row.role),
  } satisfies Membership
}

async function viewForMembership(client: PoolClient, userId: string, membership: Membership) {
  const result = await client.query(
    `SELECT organization.id, organization.name, organization.slug, organization.revision, member.role
     FROM organizations AS organization
     JOIN organization_memberships AS member
       ON member.organization_id=organization.id
      AND member.user_id=$2
      AND member.status='active'
     WHERE organization.id=$1`,
    [membership.organizationId, userId],
  )
  if (!result.rows[0]) unavailableOrganization()
  return organizationFromRow(result.rows[0])
}

export async function createOrganizationForUser(
  userId: string,
  input: OrganizationCreateInput,
  db?: Pool,
) {
  return withOrganizationUserTransaction(userId, async (client) => {
    try {
      // INSERT ... RETURNING would also evaluate the member-only SELECT policy before
      // the owner membership exists. Supply the UUID in the application transaction,
      // insert the membership, then read through the normal RLS-protected path.
      const id = randomUUID()
      await setTenantContext(client, { userId, organizationId: id })
      await client.query(
        'INSERT INTO organizations(id,name,slug,created_by) VALUES($1,$2,$3,$4)',
        [id, input.name, input.slug, userId],
      )
      await client.query(
        "INSERT INTO organization_memberships(organization_id,user_id,role,brand_scope,status) VALUES($1,$2,'owner','ALL_BRANDS','active')",
        [id, userId],
      )
      return await viewForMembership(client, userId, { organizationId: id, role: 'owner' })
    } catch (error) {
      duplicateSlug(error)
    }
  }, db)
}

export async function listOrganizationsForUser(userId: string, db?: Pool) {
  return withOrganizationUserTransaction(userId, async (client) => {
    const result = await client.query(
      `SELECT organization.id, organization.name, organization.slug, organization.revision, member.role
       FROM organization_memberships AS member
       JOIN organizations AS organization ON organization.id=member.organization_id
       WHERE member.user_id=$1 AND member.status='active'
       ORDER BY organization.created_at, organization.id`,
      [userId],
    )
    return result.rows.map(organizationFromRow)
  }, db)
}

export async function getOrganizationForUser(userId: string, organizationId: string, db?: Pool) {
  return withOrganizationUserTransaction(userId, async (client) => {
    const membership = await membershipForUser(client, userId, organizationId)
    await setTenantContext(client, { userId, organizationId })
    return await viewForMembership(client, userId, membership)
  }, db)
}

export async function updateOrganizationForUser(
  userId: string,
  organizationId: string,
  input: OrganizationUpdateInput,
  db?: Pool,
) {
  return withOrganizationUserTransaction(userId, async (client) => {
    const membership = await membershipForUser(client, userId, organizationId)
    if (!['owner', 'admin'].includes(membership.role)) unavailableOrganization()
    await setTenantContext(client, { userId, organizationId })
    const current = await client.query(
      'SELECT name,slug,revision FROM organizations WHERE id=$1 FOR UPDATE',
      [organizationId],
    )
    if (!current.rows[0]) unavailableOrganization()
    if (current.rows[0].revision !== input.revision)
      throw createError({ statusCode: 409, message: 'server.ORGANIZATION_CHANGED' })
    try {
      await client.query(
        'UPDATE organizations SET name=$1,slug=$2,revision=revision+1,updated_at=now() WHERE id=$3',
        [input.name ?? current.rows[0].name, input.slug ?? current.rows[0].slug, organizationId],
      )
    } catch (error) {
      duplicateSlug(error)
    }
    return await viewForMembership(client, userId, membership)
  }, db)
}

function legacyOrganizationSlug(slug: string, id: string) {
  return `${slug.slice(0, 47)}-${id.replaceAll('-', '')}`
}

export async function ensureOrganizationForLegacyBusiness(
  client: PoolClient,
  input: { businessId: string; userId: string; name: string; slug: string },
) {
  await setTenantContext(client, { userId: input.userId, organizationId: input.businessId })
  await client.query(
    'INSERT INTO organizations(id,name,slug,created_by) VALUES($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING',
    [input.businessId, input.name, legacyOrganizationSlug(input.slug, input.businessId), input.userId],
  )
  await client.query(
    "INSERT INTO organization_memberships(organization_id,user_id,role,brand_scope,status) VALUES($1,$2,'owner','ALL_BRANDS','active') ON CONFLICT DO NOTHING",
    [input.businessId, input.userId],
  )
}
