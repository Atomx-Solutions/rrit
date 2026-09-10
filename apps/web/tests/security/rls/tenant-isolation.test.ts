import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  assertAffectedRows,
  assertAllowed,
  assertDenied,
  assertInvisible,
  assertVisibleIds,
} from './assertions'
import { newPostPayload, seedTenantPair, type TenantPairFixture } from './fixtures'
import { createRlsHarness, type RlsHarness } from './harness'

describe('S0-A06 PostgreSQL tenant RLS harness', () => {
  let harness: RlsHarness

  beforeAll(async () => {
    harness = await createRlsHarness()
  })

  afterAll(async () => {
    await harness?.cleanup()
  })

  async function fixtures(): Promise<TenantPairFixture> {
    return await seedTenantPair(harness.unrestricted, harness.trackUserId)
  }

  it('allows each organization to read only its own rows through a broad query', async () => {
    const data = await fixtures()
    const postsForA = await harness.asTenant(data.organizationA, (client) =>
      assertAllowed(() => client.query('SELECT id FROM posts ORDER BY id')),
    )
    const assetsForA = await harness.asTenant(data.organizationA, (client) =>
      assertAllowed(() => client.query('SELECT id FROM assets ORDER BY id')),
    )
    const postsForB = await harness.asTenant(data.organizationB, (client) =>
      assertAllowed(() => client.query('SELECT id FROM posts ORDER BY id')),
    )
    const brandsForA = await harness.asTenant(data.organizationA, (client) =>
      assertAllowed(() => client.query('SELECT id FROM brands ORDER BY id')),
    )
    const brandsForB = await harness.asTenant(data.organizationB, (client) =>
      assertAllowed(() => client.query('SELECT id FROM brands ORDER BY id')),
    )

    assertVisibleIds(postsForA, [data.postAId])
    assertVisibleIds(assetsForA, [data.assetAId])
    assertVisibleIds(postsForB, [data.postBId])
    assertVisibleIds(brandsForA, [data.brandAId])
    assertVisibleIds(brandsForB, [data.brandBId])
  })

  it('fails closed when app_runtime has no tenant context', async () => {
    await fixtures()
    const result = await harness.withoutTenantContext(async (client) => {
      const posts = await client.query('SELECT id FROM posts')
      const brands = await client.query('SELECT id FROM brands')
      return { rowCount: (posts.rowCount || 0) + (brands.rowCount || 0), rows: [] }
    })
    assertInvisible(result)
  })

  it('allows own inserts and denies an INSERT forged for another organization', async () => {
    const data = await fixtures()
    const ownBrandInsert = await harness.asTenant(data.organizationA, (client) =>
      assertAllowed(() =>
        client.query(
          `INSERT INTO brands(organization_id,slug,name,profile,settings,timezone,locale,category)
           VALUES($1,$2,$3,'{}','{}','Europe/Tirane','sq-XK','cafe')`,
          [data.organizationA.organizationId, 'brand-a-second', 'Brand A Second'],
        ),
      ),
    )
    assertAffectedRows(ownBrandInsert, 1)
    const ownInsert = await harness.asTenant(data.organizationA, (client) =>
      assertAllowed(() =>
        client.query('INSERT INTO posts(id,business_id,payload) VALUES($1,$2,$3)', [
          randomUUID(),
          data.organizationA.organizationId,
          newPostPayload('Allowed A insert'),
        ]),
      ),
    )
    assertAffectedRows(ownInsert, 1)

    await harness.asTenant(data.organizationA, async (client) => {
      await assertDenied(() =>
        client.query('INSERT INTO posts(id,business_id,payload) VALUES($1,$2,$3)', [
          randomUUID(),
          data.organizationB.organizationId,
          newPostPayload('Forged B insert'),
        ]),
      )
      await assertDenied(() =>
        client.query(
          `INSERT INTO brands(organization_id,slug,name,profile,settings,timezone,locale,category)
           VALUES($1,$2,$3,'{}','{}','Europe/Tirane','sq-XK','cafe')`,
          [data.organizationB.organizationId, 'forged-brand', 'Forged Brand'],
        ),
      )
    })
  })

  it('allows own updates, filters cross-tenant updates, and rejects tenant spoofing', async () => {
    const data = await fixtures()
    const ownUpdate = await harness.asTenant(data.organizationA, (client) =>
      assertAllowed(() =>
        client.query('UPDATE posts SET payload=$1 WHERE id=$2', [
          newPostPayload('Allowed A update'),
          data.postAId,
        ]),
      ),
    )
    assertAffectedRows(ownUpdate, 1)

    const crossTenantUpdate = await harness.asTenant(data.organizationA, (client) =>
      assertAllowed(() =>
        client.query('UPDATE posts SET payload=$1 WHERE id=$2', [
          newPostPayload('Blocked B update'),
          data.postBId,
        ]),
      ),
    )
    assertInvisible(crossTenantUpdate)

    await harness.asTenant(data.organizationA, async (client) => {
      await assertDenied(() =>
        client.query('UPDATE posts SET business_id=$1 WHERE id=$2', [
          data.organizationB.organizationId,
          data.postAId,
        ]),
      )
      await assertDenied(() =>
        client.query('UPDATE brands SET organization_id=$1 WHERE id=$2', [
          data.organizationB.organizationId,
          data.brandAId,
        ]),
      )
    })
  })

  it('allows brand archive/delete only for the owning organization through RLS', async () => {
    const data = await fixtures()
    const archivedForA = await harness.asTenant(data.organizationA, (client) =>
      assertAllowed(() =>
        client.query("UPDATE brands SET status='archived', archived_at=now() WHERE id=$1", [
          data.brandAId,
        ]),
      ),
    )
    const crossDeleteForB = await harness.asTenant(data.organizationB, (client) =>
      assertAllowed(() => client.query('DELETE FROM brands WHERE id=$1', [data.brandAId])),
    )
    const deleteForA = await harness.asTenant(data.organizationA, (client) =>
      assertAllowed(() => client.query('DELETE FROM brands WHERE id=$1', [data.brandAId])),
    )
    assertAffectedRows(archivedForA, 1)
    assertInvisible(crossDeleteForB)
    assertAffectedRows(deleteForA, 1)
  })

  it('limits a restricted member to assigned brands and permits the assigned brand update', async () => {
    const data = await fixtures()
    const extraBrandId = randomUUID()
    const restrictedUserId = randomUUID()
    await harness.unrestricted.query(
      'INSERT INTO auth.users (id,email,raw_user_meta_data) VALUES ($1,$2,$3)',
      [restrictedUserId, `restricted-${restrictedUserId}@example.test`, JSON.stringify({ name: 'Restricted' })],
    )
    harness.trackUserId(restrictedUserId)
    await harness.unrestricted.query(
      "INSERT INTO organization_memberships (organization_id,user_id,role,brand_scope) VALUES ($1,$2,'marketer','RESTRICTED')",
      [data.organizationA.organizationId, restrictedUserId],
    )
    await harness.unrestricted.query(
      `INSERT INTO brands (id,organization_id,slug,name,profile,settings,timezone,locale,category)
       VALUES ($1,$2,'brand-a-extra','Brand A Extra','{}','{}','Europe/Tirane','sq-XK','cafe')`,
      [extraBrandId, data.organizationA.organizationId],
    )
    await harness.unrestricted.query(
      'INSERT INTO brand_access (organization_id,brand_id,user_id) VALUES ($1,$2,$3)',
      [data.organizationA.organizationId, data.brandAId, restrictedUserId],
    )

    const visible = await harness.asTenant(
      { organizationId: data.organizationA.organizationId, userId: restrictedUserId },
      (client) => client.query('SELECT id FROM brands ORDER BY id'),
    )
    expect(visible.rows).toEqual([{ id: data.brandAId }])
    const updated = await harness.asTenant(
      { organizationId: data.organizationA.organizationId, userId: restrictedUserId },
      (client) => client.query('UPDATE brands SET name=$1 WHERE id=$2', ['Assigned update', data.brandAId]),
    )
    assertAffectedRows(updated, 1)
  })

  it('allows own deletes and filters cross-tenant deletes for both organizations', async () => {
    const data = await fixtures()
    const ownDeleteForA = await harness.asTenant(data.organizationA, (client) =>
      assertAllowed(() => client.query('DELETE FROM posts WHERE id=$1', [data.postAId])),
    )
    const crossDeleteForA = await harness.asTenant(data.organizationA, (client) =>
      assertAllowed(() => client.query('DELETE FROM posts WHERE id=$1', [data.postBId])),
    )
    const ownDeleteForB = await harness.asTenant(data.organizationB, (client) =>
      assertAllowed(() => client.query('DELETE FROM posts WHERE id=$1', [data.postBId])),
    )
    const crossDeleteForB = await harness.asTenant(data.organizationB, (client) =>
      assertAllowed(() => client.query('DELETE FROM posts WHERE id=$1', [data.postAId])),
    )

    assertAffectedRows(ownDeleteForA, 1)
    assertInvisible(crossDeleteForA)
    assertAffectedRows(ownDeleteForB, 1)
    assertInvisible(crossDeleteForB)
  })

  it('would expose a missing posts policy to the normal allow assertions', async () => {
    const data = await fixtures()
    const rows = await harness.withAdminTransaction(async (client) => {
      await client.query('DROP POLICY posts_tenant_access ON posts')
      await harness.setRuntimeContext(client, data.organizationA)
      return await client.query('SELECT id FROM posts')
    })
    assertInvisible(rows)
  })

  it('would expose an over-permissive posts policy to the normal isolation assertions', async () => {
    const data = await fixtures()
    const rows = await harness.withAdminTransaction(async (client) => {
      await client.query('ALTER POLICY posts_tenant_access ON posts USING (true) WITH CHECK (true)')
      await harness.setRuntimeContext(client, data.organizationA)
      return await client.query('SELECT id FROM posts ORDER BY id')
    })
    assertVisibleIds(rows, [data.postAId, data.postBId])
    expect(rows.rows).toHaveLength(2)
  })
})
