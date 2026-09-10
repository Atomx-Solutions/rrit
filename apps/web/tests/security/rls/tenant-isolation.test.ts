import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  assertAffectedRows,
  assertAllowed,
  assertDeniedInSavepoint,
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

  it('allows an organization to see only its own organization and membership', async () => {
    const data = await fixtures()
    const organizationsForA = await harness.asTenant(data.organizationA, (client) =>
      assertAllowed(() => client.query('SELECT id FROM organizations ORDER BY id')),
    )
    const membershipsForA = await harness.asTenant(data.organizationA, (client) =>
      assertAllowed(() => client.query('SELECT organization_id AS id FROM organization_memberships ORDER BY organization_id')),
    )

    assertVisibleIds(organizationsForA, [data.organizationA.organizationId])
    expect(membershipsForA.rows).toHaveLength(1)
  })

  it('does not expose or permit updates to Organization A from Organization B', async () => {
    const data = await fixtures()
    const organizationAForB = await harness.asTenant(data.organizationB, (client) =>
      assertAllowed(() => client.query('SELECT id FROM organizations WHERE id=$1', [data.organizationA.organizationId])),
    )
    const updateAForB = await harness.asTenant(data.organizationB, (client) =>
      assertAllowed(() =>
        client.query('UPDATE organizations SET name=$1 WHERE id=$2', [
          'Cross-tenant update',
          data.organizationA.organizationId,
        ]),
      ),
    )
    const updateAForA = await harness.asTenant(data.organizationA, (client) =>
      assertAllowed(() =>
        client.query('UPDATE organizations SET name=$1 WHERE id=$2', [
          'Owner update',
          data.organizationA.organizationId,
        ]),
      ),
    )

    assertInvisible(organizationAForB)
    assertInvisible(updateAForB)
    assertAffectedRows(updateAForA, 1)
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

  it('installs the append-only audit ledger schema and runtime policy', async () => {
    const definition = await harness.withAdminTransaction(async (client) => {
      const [columns, constraints, indexes, policies, triggers, functions] = await Promise.all([
        client.query(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'audit_events'
           ORDER BY column_name`,
        ),
        client.query(
          `SELECT conname
           FROM pg_constraint
           WHERE conrelid = 'audit_events'::regclass
           ORDER BY conname`,
        ),
        client.query(
          `SELECT indexname
           FROM pg_indexes
           WHERE schemaname = current_schema() AND tablename = 'audit_events'
           ORDER BY indexname`,
        ),
        client.query(
          `SELECT policyname, cmd
           FROM pg_policies
           WHERE schemaname = current_schema() AND tablename = 'audit_events'`,
        ),
        client.query(
          `SELECT tgname
           FROM pg_trigger
           WHERE tgrelid = 'audit_events'::regclass AND NOT tgisinternal`,
        ),
        client.query(
          `SELECT proname
           FROM pg_proc
           WHERE pronamespace = 'app'::regnamespace
             AND proname IN ('record_audit_event', 'audit_metadata_is_safe', 'reject_audit_event_mutation')`,
        ),
      ])
      return { columns, constraints, indexes, policies, triggers, functions }
    })

    expect(definition.columns.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining([
      'actor_id',
      'organization_id',
      'resource_type',
      'resource_id',
      'action',
      'result',
      'metadata',
    ]))
    expect(definition.constraints.rows.map((row) => row.conname)).toEqual(expect.arrayContaining([
      'audit_events_business_id_fkey',
      'audit_events_organization_id_fkey',
      'audit_events_result_check',
      'audit_events_metadata_safe_check',
    ]))
    expect(definition.indexes.rows.map((row) => row.indexname)).toEqual(expect.arrayContaining([
      'audit_events_organization_created',
      'audit_events_resource_created',
    ]))
    expect(definition.policies.rows).toEqual([{ policyname: 'audit_events_read_own', cmd: 'SELECT' }])
    expect(definition.triggers.rows).toEqual([{ tgname: 'audit_events_append_only' }])
    expect(definition.functions.rows.map((row) => row.proname)).toEqual(expect.arrayContaining([
      'record_audit_event',
      'audit_metadata_is_safe',
      'reject_audit_event_mutation',
    ]))
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
      await assertDeniedInSavepoint(client, () =>
        client.query('INSERT INTO posts(id,business_id,payload) VALUES($1,$2,$3)', [
          randomUUID(),
          data.organizationB.organizationId,
          newPostPayload('Forged B insert'),
        ]),
      )
      await assertDeniedInSavepoint(client, () =>
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
      await assertDeniedInSavepoint(client, () =>
        client.query('UPDATE posts SET business_id=$1 WHERE id=$2', [
          data.organizationB.organizationId,
          data.postAId,
        ]),
      )
      await assertDeniedInSavepoint(client, () =>
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

  it('keeps audit events append-only and tenant-isolated', async () => {
    const data = await fixtures()
    const event = await harness.asTenant(data.organizationA, (client) =>
      client.query(
        `SELECT app.record_audit_event($1,$2,$3,$4,$5,$6,$7,$8,$9) AS id`,
        [
          data.organizationA.userId,
          data.organizationA.organizationId,
          data.organizationA.organizationId,
          'brand',
          data.brandAId,
          'brand.archived',
          'succeeded',
          JSON.stringify({ source: 'rls_test' }),
          3,
        ],
      ),
    )
    const eventId = event.rows[0]!.id as string

    const ownEvent = await harness.asTenant(data.organizationA, (client) =>
      client.query(
        'SELECT id,actor_id,organization_id,resource_type,resource_id,action,result,metadata FROM audit_events WHERE id=$1',
        [eventId],
      ),
    )
    expect(ownEvent.rows).toEqual([
      expect.objectContaining({
        id: eventId,
        actor_id: data.organizationA.userId,
        organization_id: data.organizationA.organizationId,
        resource_type: 'brand',
        resource_id: data.brandAId,
        action: 'brand.archived',
        result: 'succeeded',
        metadata: { source: 'rls_test' },
      }),
    ])

    const crossTenantEvent = await harness.asTenant(data.organizationB, (client) =>
      client.query('SELECT id FROM audit_events WHERE id=$1', [eventId]),
    )
    assertInvisible(crossTenantEvent)

    await harness.asTenant(data.organizationA, async (client) => {
      await assertDenied(() =>
        client.query(
          `INSERT INTO audit_events
            (business_id,actor_id,action,revision,organization_id,resource_type,resource_id,result,metadata)
           VALUES ($1,$2,'brand.created',0,$1,'brand',$3,'succeeded','{}')`,
          [data.organizationA.organizationId, data.organizationA.userId, data.brandAId],
        ),
      )
      await assertDenied(() => client.query("UPDATE audit_events SET action='brand.updated' WHERE id=$1", [eventId]))
      await assertDenied(() => client.query('DELETE FROM audit_events WHERE id=$1', [eventId]))
      await assertDenied(() =>
        client.query(
          'SELECT app.record_audit_event($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            data.organizationA.userId,
            data.organizationA.organizationId,
            data.organizationA.organizationId,
            'brand',
            data.brandAId,
            'brand.updated',
            'succeeded',
            JSON.stringify({ accessToken: 'forbidden' }),
            3,
          ],
        ),
        '23514',
      )
    })

    await expect(
      harness.withAdminTransaction((client) =>
        client.query("UPDATE audit_events SET action='brand.updated' WHERE id=$1", [eventId]),
      ),
    ).rejects.toMatchObject({ code: '55000' })
    await expect(
      harness.withAdminTransaction((client) => client.query('DELETE FROM audit_events WHERE id=$1', [eventId])),
    ).rejects.toMatchObject({ code: '55000' })

    const unchanged = await harness.asTenant(data.organizationA, (client) =>
      client.query('SELECT action,result,metadata FROM audit_events WHERE id=$1', [eventId]),
    )
    expect(unchanged.rows).toEqual([{ action: 'brand.archived', result: 'succeeded', metadata: { source: 'rls_test' } }])
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
    expect(rows.rows.map((row) => row.id)).toEqual(
      expect.arrayContaining([data.postAId, data.postBId]),
    )
    expect(rows.rows.length).toBeGreaterThan(2)
  })
})
