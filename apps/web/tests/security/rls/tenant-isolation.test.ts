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

    assertVisibleIds(postsForA, [data.postAId])
    assertVisibleIds(assetsForA, [data.assetAId])
    assertVisibleIds(postsForB, [data.postBId])
  })

  it('fails closed when app_runtime has no tenant context', async () => {
    await fixtures()
    const result = await harness.withoutTenantContext((client) =>
      assertAllowed(() => client.query('SELECT id FROM posts')),
    )
    assertInvisible(result)
  })

  it('allows own inserts and denies an INSERT forged for another organization', async () => {
    const data = await fixtures()
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
    })
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
