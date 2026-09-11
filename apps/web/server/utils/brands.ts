import type { PoolClient } from 'pg'
import {
  brandResponseSchema,
  type Brand,
  type BrandCreate,
  type BrandUpdate,
} from '../../shared/schemas/brand'
import { withTenantTransaction } from './database'

type BrandRow = {
  id: string
  organization_id: string
  revision: number
  slug: string
  name: string
  profile: Record<string, unknown>
  settings: Record<string, unknown>
  timezone: string
  locale: string
  category: string
  status: 'active' | 'archived'
  archived_at: Date | null
  created_at: Date
  updated_at: Date
}

function toBrand(row: BrandRow): Brand {
  return brandResponseSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    revision: row.revision,
    slug: row.slug,
    name: row.name,
    profile: row.profile,
    settings: row.settings,
    timezone: row.timezone,
    locale: row.locale,
    category: row.category,
    status: row.status,
    archivedAt: row.archived_at?.toISOString() || null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  })
}

const brandColumns =
  'id, organization_id, revision, slug, name, profile, settings, timezone, locale, category, status, archived_at, created_at, updated_at'

export async function requireOrganizationMember(
  client: PoolClient,
  userId: string,
  organizationId: string,
) {
  const result = await client.query(
    "SELECT role, brand_scope FROM organization_memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'",
    [organizationId, userId],
  )
  if (!result.rows[0]) throw createError({ statusCode: 404, message: 'Organizata nuk u gjet.' })
  return result.rows[0] as { role: string; brand_scope: string }
}

export async function requireOrganizationManager(
  client: PoolClient,
  userId: string,
  organizationId: string,
) {
  const member = await requireOrganizationMember(client, userId, organizationId)
  if (!['owner', 'admin'].includes(member.role))
    throw createError({ statusCode: 403, message: 'Nuk ke të drejta për këtë veprim.' })
  return member
}

export async function withOrganizationTransaction<T>(
  userId: string,
  organizationId: string,
  work: (client: PoolClient) => Promise<T>,
) {
  return withTenantTransaction({ userId, organizationId }, async (client) => {
    await requireOrganizationMember(client, userId, organizationId)
    return work(client)
  })
}

export async function listBrands(client: PoolClient, organizationId: string) {
  const result = await client.query<BrandRow>(
    `SELECT ${brandColumns} FROM brands WHERE organization_id=$1 ORDER BY created_at DESC, id`,
    [organizationId],
  )
  return result.rows.map(toBrand)
}

export async function getBrand(client: PoolClient, organizationId: string, brandId: string) {
  const result = await client.query<BrandRow>(
    `SELECT ${brandColumns} FROM brands WHERE organization_id=$1 AND id=$2`,
    [organizationId, brandId],
  )
  if (!result.rows[0]) throw createError({ statusCode: 404, message: 'Brandi nuk u gjet.' })
  return toBrand(result.rows[0]!)
}

export async function getBrandBySlug(client: PoolClient, organizationId: string, slug: string) {
  const result = await client.query<BrandRow>(
    `SELECT ${brandColumns} FROM brands WHERE organization_id=$1 AND slug=$2`,
    [organizationId, slug],
  )
  return result.rows[0] ? toBrand(result.rows[0]) : null
}

export async function createBrand(client: PoolClient, organizationId: string, input: BrandCreate) {
  const result = await client.query<BrandRow>(
    `INSERT INTO brands (organization_id, slug, name, profile, settings, timezone, locale, category)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${brandColumns}`,
    [
      organizationId,
      input.slug,
      input.name,
      JSON.stringify(input.profile),
      JSON.stringify(input.settings),
      input.timezone,
      input.locale,
      input.category,
    ],
  )
  return toBrand(result.rows[0]!)
}

export async function updateBrand(
  client: PoolClient,
  organizationId: string,
  brandId: string,
  input: BrandUpdate,
) {
  const current = await getBrand(client, organizationId, brandId)
  const expectedRevision = input.revision ?? current.revision
  if (current.status === 'archived' && input.status !== 'active')
    throw createError({ statusCode: 409, message: 'Brandi i arkivuar nuk mund të ndryshohet.' })
  const next = {
    slug: input.slug ?? current.slug,
    name: input.name ?? current.name,
    profile: input.profile ?? current.profile,
    settings: input.settings ?? current.settings,
    timezone: input.timezone ?? current.timezone,
    locale: input.locale ?? current.locale,
    category: input.category ?? current.category,
    status: input.status ?? current.status,
  }
  const result = await client.query<BrandRow>(
    `UPDATE brands
     SET slug=$1, name=$2, profile=$3, settings=$4, timezone=$5, locale=$6, category=$7,
         status=$8, archived_at=CASE WHEN $8='archived' THEN COALESCE(archived_at, now()) ELSE NULL END,
         revision=revision+1, updated_at=now()
     WHERE id=$9 AND organization_id=$10 AND revision=$11
     RETURNING ${brandColumns}`,
    [
      next.slug,
      next.name,
      JSON.stringify(next.profile),
      JSON.stringify(next.settings),
      next.timezone,
      next.locale,
      next.category,
      next.status,
      brandId,
      organizationId,
      expectedRevision,
    ],
  )
  if (!result.rows[0])
    throw createError({ statusCode: 409, message: 'Brandi ndryshoi ne nje pajisje tjeter. Ngarko versionin e fundit.' })
  return toBrand(result.rows[0]!)
}

export async function archiveBrand(client: PoolClient, organizationId: string, brandId: string) {
  const result = await client.query<BrandRow>(
    `UPDATE brands SET status='archived', archived_at=now(), revision=revision+1, updated_at=now()
     WHERE id=$1 AND organization_id=$2 AND status='active'
     RETURNING ${brandColumns}`,
    [brandId, organizationId],
  )
  if (!result.rows[0]) throw createError({ statusCode: 404, message: 'Brandi aktiv nuk u gjet.' })
  return toBrand(result.rows[0]!)
}

export async function deleteArchivedBrand(
  client: PoolClient,
  organizationId: string,
  brandId: string,
) {
  const current = await getBrand(client, organizationId, brandId)
  if (current.status !== 'archived')
    throw createError({ statusCode: 409, message: 'Arkivoje brandin para fshirjes.' })
  await client.query('DELETE FROM brands WHERE id=$1 AND organization_id=$2 AND status=\'archived\'', [
    brandId,
    organizationId,
  ])
  return { deleted: true, id: brandId }
}
