import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { assertAllowed, assertDeniedInSavepoint, assertVisibleIds } from './assertions'
import { seedTenantPair, type TenantPairFixture } from './fixtures'
import { createRlsHarness, type RlsHarness } from './harness'

// A custom package carries a negotiated price, so one organization reading or
// writing another's package would leak commercial terms. The database, not the
// query, is what has to stop it.
describe('custom package tenant isolation', () => {
  let harness: RlsHarness

  beforeAll(async () => {
    harness = await createRlsHarness()
  })

  afterAll(async () => {
    await harness?.cleanup()
  })

  async function seedPackages() {
    const data: TenantPairFixture = await seedTenantPair(harness.unrestricted, harness.trackUserId)
    const packageAId = randomUUID()
    const packageBId = randomUUID()
    for (const [id, tenant] of [
      [packageAId, data.organizationA],
      [packageBId, data.organizationB],
    ] as const)
      await harness.unrestricted.query(
        `INSERT INTO custom_packages
           (id, organization_id, name, posts_included, post_price_cents, price_cents,
            suggested_price_cents, starts_at, ends_at, status)
         VALUES ($1,$2,$3,20,150,2800,3000,now(),now() + interval '30 days','active')`,
        [id, tenant.organizationId, `Package ${id.slice(0, 8)}`],
      )
    return { ...data, packageAId, packageBId }
  }

  it('shows each organization only its own package', async () => {
    const data = await seedPackages()

    const forA = await harness.asTenant(data.organizationA, (client) =>
      assertAllowed(() => client.query('SELECT id FROM custom_packages ORDER BY id')),
    )
    const forB = await harness.asTenant(data.organizationB, (client) =>
      assertAllowed(() => client.query('SELECT id FROM custom_packages ORDER BY id')),
    )

    assertVisibleIds(forA, [data.packageAId])
    assertVisibleIds(forB, [data.packageBId])
  })

  it('hides another organization package even when its id is known', async () => {
    const data = await seedPackages()

    const result = await harness.asTenant(data.organizationA, (client) =>
      assertAllowed(() =>
        client.query('SELECT id, price_cents FROM custom_packages WHERE id = $1', [
          data.packageBId,
        ]),
      ),
    )

    expect(result.rowCount).toBe(0)
  })

  it('denies tenant writes, because only the superadmin path creates a package', async () => {
    const data = await seedPackages()

    await harness.asTenant(data.organizationA, async (client) => {
      await assertDeniedInSavepoint(client, () =>
        client.query(
          `INSERT INTO custom_packages
             (organization_id, name, posts_included, post_price_cents, price_cents,
              suggested_price_cents, starts_at, ends_at, status)
           VALUES ($1,'Self served',20,150,0,3000,now(),now() + interval '30 days','active')`,
          [data.organizationA.organizationId],
        ),
      )
      // A forged organization_id must fail on the missing privilege too, not
      // slip through because the row would have belonged to someone else.
      await assertDeniedInSavepoint(client, () =>
        client.query('UPDATE custom_packages SET price_cents = 0 WHERE id = $1', [data.packageAId]),
      )
      await assertDeniedInSavepoint(client, () =>
        client.query('DELETE FROM custom_packages WHERE id = $1', [data.packageAId]),
      )
    })
  })

  it('shows nothing when there is no tenant context', async () => {
    await seedPackages()

    const result = await harness.withoutTenantContext((client) =>
      assertAllowed(() => client.query('SELECT id FROM custom_packages')),
    )

    expect(result.rowCount).toBe(0)
  })

  it('removes packages with the organization they belong to', async () => {
    const data = await seedPackages()

    await harness.unrestricted.query('DELETE FROM organizations WHERE id = $1', [
      data.organizationB.organizationId,
    ])
    const remaining = await harness.unrestricted.query(
      'SELECT id FROM custom_packages WHERE id = $1',
      [data.packageBId],
    )

    expect(remaining.rowCount).toBe(0)
  })

  it('refuses a package whose period or size cannot hold', async () => {
    const data = await seedPackages()
    const insert = (columns: string, values: string) =>
      harness.unrestricted.query(
        `INSERT INTO custom_packages (organization_id, name, ${columns}) VALUES ($1,'Broken',${values})`,
        [data.organizationA.organizationId],
      )

    await expect(
      insert(
        'posts_included, post_price_cents, price_cents, suggested_price_cents, starts_at, ends_at, status',
        "20,150,2800,3000,now(),now() - interval '1 day','draft'",
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      insert(
        'posts_included, post_price_cents, price_cents, suggested_price_cents, starts_at, ends_at, status',
        "0,150,2800,3000,now(),now() + interval '30 days','draft'",
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      insert(
        'posts_included, post_price_cents, price_cents, suggested_price_cents, starts_at, ends_at, status',
        "20,150,2800,3000,now(),now() + interval '30 days','paused'",
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('allows only one active package per organization', async () => {
    const data = await seedPackages()

    await expect(
      harness.unrestricted.query(
        `INSERT INTO custom_packages
           (organization_id, name, posts_included, post_price_cents, price_cents,
            suggested_price_cents, starts_at, ends_at, status)
         VALUES ($1,'Second active',10,150,1500,1500,now(),now() + interval '30 days','active')`,
        [data.organizationA.organizationId],
      ),
    ).rejects.toMatchObject({ code: '23505' })

    // A draft beside the active package is legitimate: it is the next agreement
    // being prepared.
    await assertAllowed(() =>
      harness.unrestricted.query(
        `INSERT INTO custom_packages
           (organization_id, name, posts_included, post_price_cents, price_cents,
            suggested_price_cents, starts_at, ends_at, status)
         VALUES ($1,'Next agreement',10,150,1500,1500,now(),now() + interval '60 days','draft')`,
        [data.organizationA.organizationId],
      ),
    )
  })
})
