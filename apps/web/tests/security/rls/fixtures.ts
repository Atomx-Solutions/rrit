import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

export type TenantFixture = {
  organizationId: string
  userId: string
}

export type TenantPairFixture = {
  organizationA: TenantFixture
  organizationB: TenantFixture
  brandAId: string
  brandBId: string
  postAId: string
  postBId: string
  assetAId: string
  assetBId: string
}

function postPayload(label: string) {
  return JSON.stringify({
    title: `${label} post`,
    caption: `${label} tenant fixture`,
    status: 'draft',
    channel: 'Instagram',
  })
}

async function createTenant(
  pool: Pool,
  label: 'A' | 'B',
  trackUserId: (userId: string) => void,
): Promise<TenantFixture> {
  const userId = randomUUID()
  const organizationId = randomUUID()
  await pool.query(
    'INSERT INTO auth.users (id,email,raw_user_meta_data) VALUES ($1,$2,$3)',
    [userId, `rls-${label.toLowerCase()}-${userId}@example.test`, JSON.stringify({ name: `RLS ${label}` })],
  )
  trackUserId(userId)
  await pool.query('INSERT INTO businesses (id,owner_id,slug,state) VALUES ($1,$2,$3,$4)', [
    organizationId,
    userId,
    `rls-${label.toLowerCase()}-${organizationId.slice(0, 8)}`,
    JSON.stringify({}),
  ])
  await pool.query('INSERT INTO organizations (id,slug,name,created_by) VALUES ($1,$2,$3,$4)', [
    organizationId,
    `org-${label.toLowerCase()}-${organizationId.slice(0, 8)}`,
    `Organization ${label}`,
    userId,
  ])
  await pool.query(
    "INSERT INTO organization_memberships (organization_id,user_id,role,brand_scope) VALUES ($1,$2,'owner','ALL_BRANDS')",
    [organizationId, userId],
  )
  return { organizationId, userId }
}

export async function seedTenantPair(
  pool: Pool,
  trackUserId: (userId: string) => void,
): Promise<TenantPairFixture> {
  const organizationA = await createTenant(pool, 'A', trackUserId)
  const organizationB = await createTenant(pool, 'B', trackUserId)
  const postAId = randomUUID()
  const postBId = randomUUID()
  const brandAId = randomUUID()
  const brandBId = randomUUID()
  const assetAId = randomUUID()
  const assetBId = randomUUID()

  await pool.query(
    `INSERT INTO brands (id,organization_id,slug,name,profile,settings,timezone,locale,category)
     VALUES ($1,$2,'brand-a','Brand A','{}','{}','Europe/Tirane','sq-XK','cafe'),
            ($3,$4,'brand-b','Brand B','{}','{}','Europe/Tirane','sq-XK','cafe')`,
    [brandAId, organizationA.organizationId, brandBId, organizationB.organizationId],
  )

  await pool.query('INSERT INTO posts (id,business_id,payload) VALUES ($1,$2,$3),($4,$5,$6)', [
    postAId,
    organizationA.organizationId,
    postPayload('Organization A'),
    postBId,
    organizationB.organizationId,
    postPayload('Organization B'),
  ])
  await pool.query(
    "INSERT INTO assets (id,business_id,name,tags,rights,mime,bytes,size_bytes) VALUES ($1,$2,'Asset A','[]',true,'image/jpeg',$3,octet_length($3)),($4,$5,'Asset B','[]',true,'image/jpeg',$6,octet_length($6))",
    [
      assetAId,
      organizationA.organizationId,
      Buffer.from('asset-a'),
      assetBId,
      organizationB.organizationId,
      Buffer.from('asset-b'),
    ],
  )

  return { organizationA, organizationB, brandAId, brandBId, postAId, postBId, assetAId, assetBId }
}

export function newPostPayload(label: string) {
  return postPayload(label)
}
