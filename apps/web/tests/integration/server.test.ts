import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { createError } from 'h3'
import sharp from 'sharp'
import { emptyWorkspace } from '../../shared/utils/empty-workspace'
import {
  identityHash,
  grantTrial,
  claimSocialTrialIdentities,
  trialStatus,
  requireEntitlement,
  requireQuota,
  usageSnapshot,
  trialPolicy,
} from '../../server/utils/trials'
import {
  encryptMetaToken,
  decryptMetaToken,
  graphRequest,
  MetaFailure,
  metaFailureCategory,
  parseRetryAfter,
} from '../../server/utils/meta'
import {
  decodePhoto,
  localPostChecks,
  postLimits,
  postFingerprint,
  postContentSnapshot,
  requireCurrentApproval,
  requireFreshValidation,
} from '../../server/utils/post-validation'
import {
  instagramContainerTimedOut,
  publishingBatchSize,
  uniquePublicationMatch,
  reconnectionMatchesTargets,
  validMediaSignature,
  mediaSignature,
  queuePublication,
  reconcileUncertainPublication,
  runPublishingBatch,
  publicationFailureCode,
  publicationFailureDisposition,
  publicationLogicalKey,
  publicationRemediation,
  publicationRetryDelaySeconds,
  publishingMaxAttempts,
} from '../../server/utils/publishing'
import type { Post } from '../../shared/schemas/workspace'
import { planCatalogSchema } from '../../shared/schemas/catalog'
import { retentionPolicy, runRetentionBatch } from '../../server/utils/retention'
import { aiCostConfigured, calculateAiCost } from '../../server/utils/ai-costs'
import { consumeNextOutbox, enqueueOutbox } from '../../server/utils/outbox'
import { setTenantContext } from '../../server/utils/database'
import {
  archiveBrand,
  createBrand,
  deleteArchivedBrand,
  getBrand,
  listBrands,
  updateBrand,
} from '../../server/utils/brands'
import { brandCreateSchema } from '../../shared/schemas/brand'
import { assertDeniedInSavepoint } from '../security/rls/assertions'
import {
  ensureMonthlyPlan,
  restartMonthlyPlan,
  runMonthlyPlannerTick,
} from '../../server/utils/monthly-planner'
import { monthlyProviderCall } from '../../server/utils/monthly-ai'
import { createDemo } from '../fixtures/workspace'
import { syncBusinessBrain } from '../../server/utils/business-brain'
import { currentPostQuality, reviewPostQuality } from '../../server/utils/post-quality'
import { isolateMigrationSql } from '../migration-test-utils'

const env = fileURLToPath(new URL('../../../../.env', import.meta.url))
if (existsSync(env)) process.loadEnvFile(env)
const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!databaseUrl || !['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname))
  throw new Error(
    'Integration tests require a local DATABASE_URL or MIGRATION_DATABASE_URL. Remote databases are never used.',
  )
const schema = 'rrit_test_' + randomUUID().replaceAll('-', '')
const admin = new Pool({ connectionString: databaseUrl })
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` })
let createdAuthSchema = false
let createdAuthUsersTable = false
let createdWorkerRole = false
beforeAll(async () => {
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('database', () => pool)
  vi.stubGlobal('postLimits', postLimits)
  vi.stubEnv('TRIAL_HASH_KEY', 'test-trial-key-at-least-thirty-two-characters')
  vi.stubEnv('META_APP_ID', '12345')
  vi.stubEnv('META_APP_SECRET', 'test-secret')
  vi.stubEnv('META_LOGIN_CONFIG_ID', '67890')
  vi.stubEnv('META_GRAPH_VERSION', 'v26.0')
  vi.stubEnv('APP_URL', 'https://rrit.test')
  vi.stubEnv('META_REDIRECT_URI', 'https://rrit.test/api/meta/callback')
  vi.stubEnv('META_TOKEN_KEY', Buffer.alloc(32, 7).toString('base64'))
  vi.stubEnv('MEDIA_SIGNING_KEY', 'test-media-key-at-least-thirty-two-characters')
  vi.stubEnv('AI_INPUT_MICRO_EUR_PER_MILLION_TOKENS', '1000000')
  vi.stubEnv('AI_OUTPUT_MICRO_EUR_PER_MILLION_TOKENS', '2000000')
  vi.stubEnv('AI_DAILY_BUDGET_MICRO_EUR', '100000000')
  const workerRole = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker'")
  if (!workerRole.rowCount) {
    await admin.query(
      'CREATE ROLE rrit_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
    )
    createdWorkerRole = true
  }
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
  const directory = new URL('../../database/migrations/', import.meta.url)
  for (const file of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
    await pool.query(
      isolateMigrationSql(await readFile(new URL(file, directory), 'utf8'), schema),
    )
  }
  // Optional local-only Supabase audit of this exact migrated test schema.
  // Supabase's linter expects anon/authenticated roles in the local cluster.
  if (process.env.TEST_SUPABASE_CLI) {
    const report = JSON.parse(
      execFileSync(
        process.env.TEST_SUPABASE_CLI,
        ['db', 'advisors', '--db-url', databaseUrl!, '--type', 'all', '--level', 'info'],
        { encoding: 'utf8', timeout: 30000 },
      ),
    ) as {
      results: { level: string; name: string; detail: string; metadata: { schema?: string } }[]
    }
    const findings = report.results.filter(
      (item) =>
        [schema, 'app'].includes(item.metadata.schema || '') &&
        ['WARN', 'ERROR'].includes(item.level),
    )
    expect(findings, 'Supabase security/performance warnings in the migrated test schema').toEqual(
      [],
    )
  }
})
afterEach(() => {
  vi.stubEnv('PUBLISHING_ENABLED', 'false')
  vi.unstubAllGlobals()
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('database', () => pool)
  vi.stubGlobal('postLimits', postLimits)
})
afterAll(async () => {
  await pool.end()
  if (!/^rrit_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema')
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`)
  if (createdAuthUsersTable) await admin.query('DROP TABLE auth.users CASCADE')
  if (createdAuthSchema) await admin.query('DROP SCHEMA auth CASCADE')
  if (createdWorkerRole) {
    await admin.query('DROP OWNED BY rrit_worker')
    await admin.query('DROP ROLE rrit_worker')
  }
  await admin.end()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
async function business() {
  const user = randomUUID(),
    id = randomUUID(),
    email = `${user}@example.test`
  await pool.query(
    'INSERT INTO auth.users (id,email,raw_user_meta_data,created_at,updated_at) VALUES ($1,$2,$3,now(),now())',
    [user, email, JSON.stringify({ name: 'Test account' })],
  )
  await pool.query('INSERT INTO businesses (id,owner_id,slug,state) VALUES ($1,$2,$3,$4)', [
    id,
    user,
    'test-business',
    JSON.stringify(emptyWorkspace('Test account', email)),
  ])
  return { id, email, user }
}
async function insertOrganizationWithOwner(
  item: { id: string; user: string },
  slugPrefix: string,
  name: string,
) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('INSERT INTO organizations (id,slug,name,created_by) VALUES ($1,$2,$3,$4)', [
      item.id,
      `${slugPrefix}-${item.id.slice(0, 8)}`,
      name,
      item.user,
    ])
    await client.query(
      "INSERT INTO organization_memberships (organization_id,user_id,role,brand_scope) VALUES ($1,$2,'owner','ALL_BRANDS')",
      [item.id, item.user],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
async function organization(item: { id: string; user: string }) {
  await insertOrganizationWithOwner(item, 'publisher-org', 'Publisher test organization')
}
async function grant(id: string, email: string, device: string) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await grantTrial(client, id, email, device)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

describe('tenant row-level security', () => {
  it('denies cross-tenant reads and writes and fails closed without context', async () => {
    const first = await business()
    const second = await business()
    const firstPost = randomUUID()
    const secondPost = randomUUID()
    const payload = (caption: string) =>
      JSON.stringify({
        title: 'Tenant test',
        caption,
        status: 'draft',
        channel: 'Instagram',
      })
    await pool.query('INSERT INTO posts(id,business_id,payload) VALUES($1,$2,$3)', [
      firstPost,
      first.id,
      payload('First tenant'),
    ])
    await pool.query('INSERT INTO posts(id,business_id,payload) VALUES($1,$2,$3)', [
      secondPost,
      second.id,
      payload('Second tenant'),
    ])

    const client = await admin.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL ROLE app_runtime')
      await client.query(`SET LOCAL search_path TO "${schema}", public`)
      await setTenantContext(client, { userId: first.user, organizationId: first.id })
      expect((await client.query('SELECT id FROM posts ORDER BY id')).rows).toEqual([
        { id: firstPost },
      ])
      await assertDeniedInSavepoint(client, () =>
        client.query('INSERT INTO posts(id,business_id,payload) VALUES($1,$2,$3)', [
          randomUUID(),
          second.id,
          payload('Forged tenant'),
        ]),
      )
      expect(
        (
          await client.query('UPDATE posts SET payload=$1 WHERE id=$2', [
            payload('Changed'),
            secondPost,
          ])
        ).rowCount,
      ).toBe(0)
      expect((await client.query('DELETE FROM posts WHERE id=$1', [secondPost])).rowCount).toBe(0)
      await assertDeniedInSavepoint(client, () =>
        client.query('CREATE TABLE rls_forbidden (id integer)'),
      )
      await client.query('ROLLBACK')
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }

    const missingContext = await admin.connect()
    try {
      await missingContext.query('BEGIN')
      await missingContext.query('SET LOCAL ROLE app_runtime')
      await missingContext.query(`SET LOCAL search_path TO "${schema}", public`)
      expect((await missingContext.query('SELECT id FROM posts')).rows).toEqual([])
      await missingContext.query('ROLLBACK')
    } finally {
      missingContext.release()
    }
  })
})

describe('brand domain lifecycle', () => {
  it('supports create, read, update, archive and guarded delete', async () => {
    const item = await business()
    await insertOrganizationWithOwner(item, 'brand-org', 'Brand test organization')
    const input = brandCreateSchema.parse({
      name: 'Test Brand',
      slug: 'test-brand',
      timezone: 'Europe/Tirane',
      locale: 'sq-XK',
      category: 'cafe',
    })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const created = await createBrand(client, item.id, input)
      expect(created.organizationId).toBe(item.id)
      expect((await listBrands(client, item.id)).map((brand) => brand.id)).toContain(created.id)
      expect((await getBrand(client, item.id, created.id)).name).toBe('Test Brand')
      const updated = await updateBrand(client, item.id, created.id, { name: 'Updated Brand' })
      expect(updated.name).toBe('Updated Brand')
      expect(updated.revision).toBe(created.revision + 1)
      await expect(
        updateBrand(client, item.id, created.id, {
          name: 'Stale Update',
          revision: created.revision,
        }),
      ).rejects.toMatchObject({ statusCode: 409 })
      const archived = await archiveBrand(client, item.id, created.id)
      expect(archived.status).toBe('archived')
      await expect(
        updateBrand(client, item.id, created.id, { name: 'Rejected Update' }),
      ).rejects.toMatchObject({
        statusCode: 409,
      })
      await expect(deleteArchivedBrand(client, item.id, created.id)).resolves.toEqual({
        deleted: true,
        id: created.id,
      })
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })
})

describe('Business Brain persistence', () => {
  it('records immutable revisions, demotes changed claims and archives removed facts', async () => {
    const item = await business()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL ROLE app_runtime')
      await setTenantContext(client, { userId: item.user, organizationId: item.id })
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [item.id])
      const original = emptyWorkspace().brand
      const submitted = {
        ...original,
        facts: [{ id: 'price', text: 'Coffee costs 2 EUR.', source: 'Price list', verified: true }],
      }
      const first = await syncBusinessBrain(client, item.id, item.user, submitted, original)
      expect(first.brainVersion).toBe(2)
      const unchanged = await syncBusinessBrain(client, item.id, item.user, first, first)
      expect(unchanged.brainVersion).toBe(2)
      const second = await syncBusinessBrain(
        client,
        item.id,
        item.user,
        { ...first, facts: [{ ...first.facts[0]!, text: 'Coffee costs 3 EUR.' }] },
        first,
      )
      expect(second.facts[0]).toMatchObject({ verified: false, revision: 2 })
      expect(
        (
          await client.query('SELECT status,revision FROM business_facts WHERE business_id=$1', [
            item.id,
          ])
        ).rows,
      ).toEqual([{ status: 'proposed', revision: 2 }])
      expect(
        (
          await client.query(
            'SELECT snapshot FROM business_brain_versions WHERE business_id=$1 AND version=2',
            [item.id],
          )
        ).rows[0].snapshot.facts[0].text,
      ).toBe('Coffee costs 2 EUR.')
      await client.query('SAVEPOINT immutable')
      await expect(
        client.query("UPDATE business_brain_versions SET snapshot='{}' WHERE business_id=$1", [
          item.id,
        ]),
      ).rejects.toMatchObject({ code: '42501' })
      await client.query('ROLLBACK TO SAVEPOINT immutable')
      const removed = await syncBusinessBrain(
        client,
        item.id,
        item.user,
        { ...second, facts: [] },
        second,
      )
      expect(
        (await client.query('SELECT status FROM business_facts WHERE business_id=$1', [item.id]))
          .rows[0].status,
      ).toBe('archived')
      await expect(
        syncBusinessBrain(client, item.id, item.user, submitted, removed),
      ).rejects.toThrow('arkivuar')
      await client.query('ROLLBACK')
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
  it('isolates fact/history rows and forbids tenant reassignment', async () => {
    const first = await business(),
      second = await business()
    await pool.query(
      "INSERT INTO business_brain_versions(business_id,version,snapshot) VALUES($1,1,'{}'),($2,1,'{}')",
      [first.id, second.id],
    )
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL ROLE app_runtime')
      await setTenantContext(client, { userId: first.user, organizationId: first.id })
      expect((await client.query('SELECT business_id FROM business_brain_versions')).rows).toEqual([
        { business_id: first.id },
      ])
      await client.query(
        "INSERT INTO business_facts(business_id,id,text,source,kind,status,origin,revision) VALUES($1,'test','Test','Owner','fact','verified','user',1)",
        [first.id],
      )
      await client.query('SAVEPOINT reassignment')
      await expect(
        client.query('UPDATE business_facts SET business_id=$1 WHERE business_id=$2', [
          second.id,
          first.id,
        ]),
      ).rejects.toMatchObject({ code: '42501' })
      await client.query('ROLLBACK TO SAVEPOINT reassignment')
      await setTenantContext(client, { userId: second.user, organizationId: second.id })
      expect((await client.query('SELECT id FROM business_facts')).rows).toEqual([])
      await client.query('ROLLBACK')
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})

describe('durable transactional outbox', () => {
  it('commits with domain data, deduplicates delivery and recovers a stale claim', async () => {
    await pool.query('CREATE TABLE outbox_test_effects (message_id uuid PRIMARY KEY, value text)')
    const client = await pool.connect()
    let messageId: string
    try {
      await client.query('BEGIN')
      await client.query('CREATE TABLE outbox_test_domain (id uuid PRIMARY KEY, value text)')
      const domainId = randomUUID()
      await client.query('INSERT INTO outbox_test_domain (id,value) VALUES ($1,$2)', [
        domainId,
        'committed',
      ])
      const first = await enqueueOutbox(client, {
        topic: 'test.domain-created',
        deduplicationKey: domainId,
        payload: { domainId },
      })
      const duplicate = await enqueueOutbox(client, {
        topic: 'test.domain-created',
        deduplicationKey: domainId,
        payload: { domainId },
      })
      messageId = first.id
      expect(duplicate.id).toBe(first.id)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

    const consume = () =>
      consumeNextOutbox(pool, {
        consumer: 'test-worker',
        topics: ['test.domain-created'],
        handler: async (message, transaction) => {
          await transaction.query(
            'INSERT INTO outbox_test_effects (message_id,value) VALUES ($1,$2)',
            [message.id, String(message.payload.domainId)],
          )
        },
      })
    const concurrent = await Promise.all([consume(), consume()])
    expect(concurrent.reduce((sum, item) => sum + item.processed, 0)).toBe(1)
    expect(
      (await pool.query('SELECT count(*)::integer AS count FROM outbox_test_effects')).rows[0],
    ).toEqual({ count: 1 })

    const recoveryKey = randomUUID()
    const recoveryClient = await pool.connect()
    let recoveryId: string
    try {
      await recoveryClient.query('BEGIN')
      recoveryId = (
        await enqueueOutbox(recoveryClient, {
          topic: 'test.recovery',
          deduplicationKey: recoveryKey,
          payload: { recoveryKey },
        })
      ).id
      await recoveryClient.query('COMMIT')
    } finally {
      recoveryClient.release()
    }
    await pool.query(
      "UPDATE outbox_messages SET status='processing',locked_at=now()-interval '10 minutes',attempt_count=1 WHERE id=$1",
      [recoveryId],
    )
    const recovered = await consumeNextOutbox(pool, {
      consumer: 'recovery-worker',
      topics: ['test.recovery'],
      leaseSeconds: 60,
      handler: async (message, transaction) => {
        await transaction.query(
          'INSERT INTO outbox_test_effects (message_id,value) VALUES ($1,$2)',
          [message.id, 'recovered'],
        )
      },
    })
    expect(recovered).toMatchObject({ processed: 1, completed: true, messageId: recoveryId })
    expect(
      (
        await pool.query('SELECT status,attempt_count FROM outbox_messages WHERE id=$1', [
          recoveryId,
        ])
      ).rows[0],
    ).toEqual({ status: 'completed', attempt_count: 2 })
    expect(
      (await pool.query('SELECT status FROM outbox_messages WHERE id=$1', [messageId])).rows[0],
    ).toEqual({ status: 'completed' })
  })

  it('rolls back the outbox row when its domain transaction rolls back', async () => {
    const client = await pool.connect()
    const key = randomUUID()
    try {
      await client.query('BEGIN')
      await enqueueOutbox(client, {
        topic: 'test.rollback',
        deduplicationKey: key,
        payload: { key },
      })
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
    expect(
      (
        await pool.query(
          'SELECT count(*)::integer AS count FROM outbox_messages WHERE deduplication_key=$1',
          [key],
        )
      ).rows[0],
    ).toEqual({ count: 0 })
  })
})
describe('trial transactions with PostgreSQL', () => {
  it('grants exactly 72 server hours once and never extends it on retry', async () => {
    const item = await business()
    await grant(item.id, item.email, randomUUID())
    const before = await trialStatus(item.id, pool)
    expect(before.state).toBe('active')
    expect(before.features).toEqual(
      expect.arrayContaining(['posts', 'media', 'validation', 'social_import', 'publishing', 'ai']),
    )
    expect(before.limits).toMatchObject({ posts_per_month: 12, social_accounts: 2, members: 1 })
    expect(Date.parse(before.expiresAt!) - Date.parse(before.startsAt!)).toBe(72 * 3600000)
    await grant(item.id, item.email, randomUUID())
    expect((await trialStatus(item.id, pool)).expiresAt).toBe(before.expiresAt)
  })
  it('allows only one concurrent trial for the same device', async () => {
    const a = await business(),
      b = await business(),
      device = randomUUID()
    await Promise.all([grant(a.id, a.email, device), grant(b.id, b.email, device)])
    const statuses = await Promise.all([trialStatus(a.id, pool), trialStatus(b.id, pool)])
    expect(statuses.map((value) => value.state).sort()).toEqual(['active', 'blocked'])
  })
  it('normalizes email claims and blocks previous verified identities', async () => {
    const a = await business(),
      b = await business()
    await grant(a.id, a.email, randomUUID())
    await grant(b.id, ' ' + a.email.toUpperCase() + ' ', randomUUID())
    expect((await trialStatus(b.id, pool)).state).toBe('blocked')
    expect(identityHash('email', a.email)).not.toContain(a.email)
  })
  it('revokes a new trial when a Meta account has already received one', async () => {
    const a = await business(),
      b = await business(),
      page = randomUUID()
    await grant(a.id, a.email, randomUUID())
    await grant(b.id, b.email, randomUUID())
    for (const item of [a, b]) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await claimSocialTrialIdentities(client, item.id, [{ kind: 'facebook_page', value: page }])
        await client.query('COMMIT')
      } finally {
        client.release()
      }
    }
    expect((await trialStatus(a.id, pool)).state).toBe('active')
    expect((await trialStatus(b.id, pool)).state).toBe('revoked')
    await expect(requireEntitlement(b.id, 'posts', pool)).rejects.toMatchObject({ statusCode: 402 })
  })
  it('enforces expiry for every feature while preserving the business', async () => {
    const item = await business()
    await grant(item.id, item.email, randomUUID())
    await pool.query(
      "UPDATE trial_grants SET starts_at=now()-interval '4 days',expires_at=now()-interval '1 hour' WHERE business_id=$1",
      [item.id],
    )
    for (const feature of (await trialPolicy(pool)).features)
      await expect(requireEntitlement(item.id, feature, pool)).rejects.toMatchObject({
        statusCode: 402,
      })
    expect((await pool.query('SELECT id FROM businesses WHERE id=$1', [item.id])).rowCount).toBe(1)
  })
  it('reads duration from the catalog and accepts only active paid entitlements', async () => {
    const item = await business()
    await pool.query(
      "INSERT INTO entitlements(business_id,valid_from,valid_until,features,source,plan_name,plan_version,limits) VALUES ($1,now()-interval '1 hour',now()+interval '1 hour','[\"posts\"]','test','Test',1,$2)",
      [
        item.id,
        JSON.stringify({
          posts_per_month: 12,
          ai_requests_per_day: 0,
          media_storage_bytes: 1024,
          social_accounts: 0,
          members: 1,
        }),
      ],
    )
    await expect(requireEntitlement(item.id, 'posts', pool)).resolves.toBeUndefined()
    await expect(requireEntitlement(item.id, 'publishing', pool)).rejects.toMatchObject({
      statusCode: 402,
    })
    expect((await usageSnapshot(item.id, pool)).posts_per_month).toEqual({ current: 0, limit: 12 })
    await expect(requireQuota(item.id, 'posts_per_month', 13, pool)).rejects.toMatchObject({
      statusCode: 402,
      data: { code: 'QUOTA_EXCEEDED', current: 0, limit: 12 },
    })
  })
  it('validates one typed EUR catalog for display and enforcement', async () => {
    const rows = await pool.query(
      'SELECT name,version,monthly_cents,currency,annual_discount_percent,description,features,feature_codes,limits,purchasable FROM plan_catalog ORDER BY sort_order',
    )
    const plans = rows.rows.map((row) =>
      planCatalogSchema.parse({
        name: row.name,
        version: row.version,
        monthlyCents: row.monthly_cents,
        currency: row.currency,
        annualDiscount: row.annual_discount_percent,
        description: row.description,
        displayFeatures: row.features,
        entitlements: row.feature_codes,
        limits: row.limits,
        purchasable: row.purchasable,
      }),
    )
    expect(plans).toHaveLength(3)
    expect(plans.every((plan) => plan.currency === 'EUR')).toBe(true)
    expect(plans.map(({ name, version }) => ({ name, version }))).toEqual([
      { name: 'Fillimi', version: 2 },
      { name: 'Përditë', version: 2 },
      { name: 'Më shumë', version: 3 },
    ])
    expect(plans.find((plan) => plan.name === 'Fillimi')?.limits.posts_per_month).toBe(12)
    expect(plans.find((plan) => plan.name === 'Përditë')?.entitlements).toContain('ai')
  })
  it('seeds PRC-01 plans and grants an expiring split trial balance', async () => {
    const plans = await pool.query(
      'SELECT code,monthly_cents,posts_per_month,monthly_credits,style_fetch_post_count,annual_discount_percent,is_trial FROM plans ORDER BY sort_order',
    )
    expect(plans.rows).toEqual([
      { code: 'free-trial', monthly_cents: 0, posts_per_month: 3, monthly_credits: 250, style_fetch_post_count: 10, annual_discount_percent: 0, is_trial: true },
      { code: 'pako-1', monthly_cents: 2499, posts_per_month: 14, monthly_credits: 1000, style_fetch_post_count: 10, annual_discount_percent: 15, is_trial: false },
      { code: 'pako-2', monthly_cents: 4499, posts_per_month: 30, monthly_credits: 2250, style_fetch_post_count: 20, annual_discount_percent: 15, is_trial: false },
      { code: 'pako-3', monthly_cents: 7999, posts_per_month: 60, monthly_credits: 4000, style_fetch_post_count: 30, annual_discount_percent: 15, is_trial: false },
    ])
    const item = await business()
    await insertOrganizationWithOwner(item, 'credit-org', 'Credit organization')
    await grant(item.id, item.email, randomUUID())
    expect((await pool.query('SELECT plan_code,status FROM subscriptions WHERE organization_id=$1', [item.id])).rows).toEqual([
      { plan_code: 'free-trial', status: 'trialing' },
    ])
    expect((await pool.query('SELECT research_remaining_credits,research_reserved_credits,generation_remaining_credits,generation_reserved_credits FROM credit_balances WHERE organization_id=$1', [item.id])).rows).toEqual([
      { research_remaining_credits: 125, research_reserved_credits: 0, generation_remaining_credits: 125, generation_reserved_credits: 0 },
    ])
    expect((await pool.query("SELECT event_type,wallet,credit_delta FROM credit_ledger WHERE organization_id=$1 ORDER BY wallet", [item.id])).rows).toEqual([
      { event_type: 'grant', wallet: 'generation', credit_delta: 125 },
      { event_type: 'grant', wallet: 'research', credit_delta: 125 },
    ])
  })
})
describe('real photo decoding and validation', () => {
  it('rejects a fake JPEG and strips EXIF from a decoded image', async () => {
    await expect(decodePhoto(Buffer.from([255, 216, 0, 0, 255, 217]))).rejects.toMatchObject({
      statusCode: 422,
    })
    const bytes = await sharp({
      create: { width: 800, height: 800, channels: 3, background: '#739276' },
    })
      .jpeg()
      .withMetadata()
      .toBuffer()
    const photo = await decodePhoto(bytes)
    expect((await sharp(photo.data).metadata()).exif).toBeUndefined()
    expect(photo.info.width).toBe(800)
  })
  it('checks tenant ownership, Instagram dimensions, placeholders and stale approval', async () => {
    const a = await business(),
      b = await business(),
      assetId = randomUUID(),
      postId = randomUUID()
    const photo = await decodePhoto(
      await sharp({ create: { width: 800, height: 800, channels: 3, background: '#739276' } })
        .jpeg()
        .toBuffer(),
    )
    await pool.query(
      "INSERT INTO assets(id,business_id,name,tags,rights,mime,bytes,width,height,size_bytes) VALUES($1,$2,'Photo','[]',true,'image/jpeg',$3,800,800,octet_length($3::bytea))",
      [assetId, a.id, photo.data],
    )
    const post: Post = {
      id: postId,
      title: 'Product launch',
      caption: 'Produkti ynë i ri.',
      status: 'draft',
      channel: 'Instagram',
      format: 'static',
      image: `/api/media/${assetId}`,
      pillar: 'Produkti',
      scheduledAt: null,
      version: 1,
      history: [],
      policy: 'warn',
      policyReason: '',
    }
    expect((await localPostChecks(post, a.id, pool)).every((check) => check.passed)).toBe(true)
    expect(
      (await localPostChecks(post, b.id, pool)).find((check) => check.key === 'rights')?.passed,
    ).toBe(false)
    expect(
      (await localPostChecks({ ...post, caption: 'Oferta: [çmimi]' }, a.id, pool)).find(
        (check) => check.key === 'placeholders',
      )?.passed,
    ).toBe(false)
    await pool.query('INSERT INTO posts(id,business_id,payload) VALUES($1,$2,$3)', [
      postId,
      a.id,
      JSON.stringify(post),
    ])
    await pool.query(
      'INSERT INTO post_validations(post_id,business_id,post_version,content_version,fingerprint,result) VALUES($1,$2,1,1,$3,\'{"passed":true}\')',
      [postId, a.id, postFingerprint(post)],
    )
    await expect(requireFreshValidation(post, a.id, pool)).resolves.toBeUndefined()
    await expect(
      requireFreshValidation({ ...post, caption: 'Changed' }, a.id, pool),
    ).rejects.toMatchObject({ statusCode: 422 })
    await pool.query(
      "UPDATE post_validations SET created_at=now()-interval '6 minutes' WHERE post_id=$1",
      [postId],
    )
    await expect(requireFreshValidation(post, a.id, pool)).rejects.toMatchObject({
      statusCode: 422,
    })
  })
})
describe('retention policy', () => {
  it('purges expired operational records from database policy under one batch', async () => {
    const item = await business()
    const generation = randomUUID()
    await pool.query(
      "INSERT INTO ai_generations(id,business_id,input_hash,status,created_at) VALUES($1,$2,'old','failed',now()-interval '120 days')",
      [generation, item.id],
    )
    await pool.query(
      "INSERT INTO trial_claims(kind,value_hash,business_id,claimed_at) VALUES('email',$1,$2,now()-interval '400 days')",
      [randomUUID(), item.id],
    )
    expect((await retentionPolicy(pool)).trial_claim_days).toBe(365)
    const result = await runRetentionBatch(pool)
    expect(result).toMatchObject({ aiGenerations: 1, trialClaims: 1 })
    expect(
      (await pool.query('SELECT id FROM ai_generations WHERE id=$1', [generation])).rowCount,
    ).toBe(0)
    const run = await pool.query(
      "SELECT last_completed_at,result,failure FROM maintenance_runs WHERE name='retention'",
    )
    expect(run.rows[0]).toMatchObject({ failure: null })
    expect(run.rows[0].last_completed_at).toBeInstanceOf(Date)
  })
})
describe('AI cost reservations', () => {
  it('calculates configured cost and permits only one reservation per generation', async () => {
    expect(aiCostConfigured()).toBe(true)
    expect(calculateAiCost(100, 50)).toBe(200)
    const item = await business()
    const generation = randomUUID()
    await pool.query(
      "INSERT INTO ai_generations(id,business_id,input_hash,status) VALUES($1,$2,'hash','pending')",
      [generation, item.id],
    )
    const insert =
      "INSERT INTO ai_cost_ledger(generation_id,business_id,model,status,estimated_input_tokens,reserved_output_tokens,reserved_cost_micro_eur) VALUES($1,$2,'test-model','reserved',100,50,200)"
    await pool.query(insert, [generation, item.id])
    await expect(pool.query(insert, [generation, item.id])).rejects.toMatchObject({ code: '23505' })
    const settled = await pool.query(
      "UPDATE ai_cost_ledger SET status='released',settled_at=now() WHERE generation_id=$1 AND status='reserved' RETURNING status",
      [generation],
    )
    expect(settled.rows[0].status).toBe('released')
    expect(
      (
        await pool.query(
          "UPDATE ai_cost_ledger SET status='released' WHERE generation_id=$1 AND status='reserved' RETURNING id",
          [generation],
        )
      ).rowCount,
    ).toBe(0)
  })
})
describe('optional Meta calendar', () => {
  it('measures Instagram processing from container creation, not schedule creation', () => {
    const now = Date.parse('2026-09-07T12:00:00.000Z')
    expect(instagramContainerTimedOut(new Date(now - 59 * 60 * 1000), now)).toBe(false)
    expect(instagramContainerTimedOut(new Date(now - 61 * 60 * 1000), now)).toBe(true)
  })
  it('keeps publisher throughput configuration bounded', () => {
    expect(publishingBatchSize()).toBe(5)
    expect(publishingBatchSize('1')).toBe(1)
    expect(publishingBatchSize('25')).toBe(25)
    expect(publishingBatchSize('0')).toBe(5)
    expect(publishingBatchSize('100')).toBe(5)
    expect(publishingBatchSize('not-a-number')).toBe(5)
  })
  it('reconciles only one exact provider result after the scheduled window', () => {
    const runAt = new Date('2026-09-07T12:00:00.000Z')
    const post = {
      id: randomUUID(),
      title: 'Kontrolli',
      caption: 'Teksti i saktë',
      status: 'failed',
      channel: 'Facebook',
      format: 'static',
      image: '',
      pillar: 'Produkti',
      scheduledAt: runAt.toISOString(),
      publicationMode: 'automatic',
      version: 3,
      contentVersion: 1,
      history: [],
      policy: 'pass',
      policyReason: '',
    } satisfies Post
    const exact = { id: 'provider-1', message: post.caption, created_time: runAt.toISOString() }
    expect(uniquePublicationMatch([exact], post, runAt)).toEqual(exact)
    expect(
      uniquePublicationMatch(
        [exact, { ...exact, id: 'provider-2', created_time: '2026-09-07T12:01:00.000Z' }],
        post,
        runAt,
      ),
    ).toBeNull()
    expect(
      uniquePublicationMatch([{ ...exact, created_time: '2026-09-07T11:50:00.000Z' }], post, runAt),
    ).toBeNull()
  })
  it('allows uncertain recovery only through the original provider targets', () => {
    const uncertain = [
      {
        status: 'uncertain',
        target_page_id: 'page-a',
        target_instagram_id: 'instagram-a',
      },
    ]
    expect(reconnectionMatchesTargets(uncertain, 'page-a', 'instagram-a')).toBe(true)
    expect(reconnectionMatchesTargets(uncertain, 'page-b', 'instagram-a')).toBe(false)
    expect(reconnectionMatchesTargets(uncertain, 'page-a', 'instagram-b')).toBe(false)
    expect(
      reconnectionMatchesTargets(
        [{ ...uncertain[0]!, status: 'processing' }],
        'page-a',
        'instagram-a',
      ),
    ).toBe(false)
  })
  it('keeps identical provider post IDs separate for different source accounts', async () => {
    const item = await business()
    const insert =
      "INSERT INTO social_posts(business_id,channel,source_account_id,provider_id,published_at,media_type) VALUES($1,'Facebook',$2,'same-provider-id',now(),'POST')"
    await pool.query(insert, [item.id, 'page-a'])
    await pool.query(insert, [item.id, 'page-b'])
    await expect(pool.query(insert, [item.id, 'page-a'])).rejects.toMatchObject({ code: '23505' })
  })
  it('requires publication scope for publishing, while preserving local approvals', async () => {
    const item = await business()
    const post: Post = {
      id: randomUUID(),
      title: 'Postim lokal',
      caption: 'Produkti ynë.',
      status: 'review',
      channel: 'Facebook',
      format: 'static',
      image: '',
      pillar: 'Produkti',
      scheduledAt: null,
      version: 1,
      history: [],
      policy: 'pass',
      policyReason: '',
    }
    await pool.query('INSERT INTO posts(id,business_id,payload) VALUES($1,$2,$3)', [
      post.id,
      item.id,
      JSON.stringify(post),
    ])
    await pool.query(
      'INSERT INTO post_validations(post_id,business_id,post_version,content_version,fingerprint,result) VALUES($1,$2,1,1,$3,$4)',
      [post.id, item.id, postFingerprint(post), JSON.stringify({ scope: 'content', passed: true })],
    )
    await expect(requireFreshValidation(post, item.id, pool, 'content')).resolves.toBeUndefined()
    await expect(requireFreshValidation(post, item.id, pool, 'publication')).rejects.toMatchObject({
      statusCode: 422,
    })
    await pool.query(
      'INSERT INTO post_validations(post_id,business_id,post_version,content_version,fingerprint,result) VALUES($1,$2,1,1,$3,$4)',
      [
        post.id,
        item.id,
        postFingerprint(post),
        JSON.stringify({ scope: 'publication', passed: false }),
      ],
    )
    await expect(requireFreshValidation(post, item.id, pool, 'content')).resolves.toBeUndefined()
    await expect(requireFreshValidation(post, item.id, pool, 'publication')).rejects.toMatchObject({
      statusCode: 422,
    })
    await pool.query(
      "UPDATE post_validations SET result=jsonb_set(result,'{passed}','true') WHERE post_id=$1 AND result->>'scope'='publication'",
      [post.id],
    )
    await expect(
      requireFreshValidation(post, item.id, pool, 'publication'),
    ).resolves.toBeUndefined()
  })
  it('preserves existing queued consent on migration and never queues manual entries', async () => {
    const item = await business(),
      date = new Date(Date.now() + 3600000).toISOString()
    const manual: Post = {
      id: randomUUID(),
      title: 'Postim lokal',
      caption: 'Produkti ynë.',
      status: 'scheduled',
      channel: 'Instagram',
      format: 'static',
      image: '',
      pillar: 'Produkti',
      scheduledAt: date,
      version: 2,
      history: [],
      policy: 'pass',
      policyReason: '',
    }
    const automatic = { ...manual, id: randomUUID() }
    for (const post of [manual, automatic])
      await pool.query('INSERT INTO posts(id,business_id,payload) VALUES($1,$2,$3)', [
        post.id,
        item.id,
        JSON.stringify(post),
      ])
    await pool.query(
      "INSERT INTO publication_jobs(post_id,business_id,post_version,content_version,status,run_at) VALUES($1,$2,2,1,'pending',$3)",
      [automatic.id, item.id, date],
    )
    await pool.query(
      await readFile(
        new URL('../../database/migrations/0007_optional_meta_calendar.sql', import.meta.url),
        'utf8',
      ),
    )
    const rows = await pool.query('SELECT id,payload FROM posts WHERE business_id=$1', [item.id])
    expect(rows.rows.find((row) => row.id === manual.id).payload.publicationMode).toBe('manual')
    expect(rows.rows.find((row) => row.id === automatic.id).payload.publicationMode).toBe(
      'automatic',
    )
    const client = await pool.connect()
    try {
      for (const publicationMode of [undefined, 'manual'] as const)
        await expect(
          queuePublication(client, { ...manual, publicationMode }, item.id, date),
        ).rejects.toMatchObject({ statusCode: 422 })
    } finally {
      client.release()
    }
    expect(
      (await pool.query('SELECT id FROM publication_jobs WHERE post_id=$1', [manual.id])).rowCount,
    ).toBe(0)
  })
  it('publishes once with two workers and reconciles a timeout-after-write without resending', async () => {
    const item = await business()
    await organization(item)
    await grant(item.id, item.email, randomUUID())
    const assetId = randomUUID()
    const photo = await decodePhoto(
      await sharp({ create: { width: 800, height: 800, channels: 3, background: '#739276' } })
        .jpeg()
        .toBuffer(),
    )
    await pool.query(
      "INSERT INTO assets(id,business_id,name,tags,rights,mime,bytes,width,height,size_bytes) VALUES($1,$2,'Worker photo','[]',true,'image/jpeg',$3,800,800,octet_length($3::bytea))",
      [assetId, item.id, photo.data],
    )
    const pageId = '123456789'
    await pool.query(
      "INSERT INTO meta_connections(business_id,facebook_user_id,token_ciphertext,expires_at,scopes,status,page_id,page_name,page_token_ciphertext) VALUES($1,'user-1',$2,now()+interval '1 day',$3,'connected',$4,'Test page',$5)",
      [
        item.id,
        encryptMetaToken('user-token', item.id),
        JSON.stringify(['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']),
        pageId,
        encryptMetaToken('page-token', item.id),
      ],
    )
    const makePost = (caption: string): Post => ({
      id: randomUUID(),
      title: 'Worker fixture',
      caption,
      status: 'scheduled',
      channel: 'Facebook',
      format: 'static',
      image: `/api/media/${assetId}`,
      pillar: 'Produkti',
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
      publicationMode: 'automatic',
      version: 2,
      contentVersion: 1,
      history: [],
      policy: 'pass',
      policyReason: '',
    })
    const queue = async (post: Post) => {
      await pool.query(
        'INSERT INTO posts(id,business_id,payload,content_version) VALUES($1,$2,$3,1)',
        [post.id, item.id, JSON.stringify(post)],
      )
      await pool.query(
        "INSERT INTO publication_jobs(post_id,business_id,post_version,content_version,status,run_at,target_page_id) VALUES($1,$2,2,1,'pending',now()-interval '1 second',$3)",
        [post.id, item.id, pageId],
      )
    }
    const duplicate = makePost('E njëjta kërkesë logjike ruan të njëjtin job.')
    duplicate.scheduledAt = new Date(Date.now() + 3600000).toISOString()
    await pool.query(
      'INSERT INTO posts(id,business_id,payload,content_version) VALUES($1,$2,$3,1)',
      [duplicate.id, item.id, JSON.stringify(duplicate)],
    )
    const key = publicationLogicalKey(item.id, duplicate.id, duplicate.version)
    const firstClient = await pool.connect()
    const secondClient = await pool.connect()
    try {
      const duplicateResults = await Promise.all([
        queuePublication(firstClient, duplicate, item.id, duplicate.scheduledAt, key),
        queuePublication(secondClient, duplicate, item.id, duplicate.scheduledAt, key),
      ])
      expect(duplicateResults[0].id).toBe(duplicateResults[1].id)
      expect(
        (
          await pool.query(
            'SELECT count(*)::integer AS count FROM publication_jobs WHERE business_id=$1 AND logical_key=$2',
            [item.id, key],
          )
        ).rows[0].count,
      ).toBe(1)
    } finally {
      firstClient.release()
      secondClient.release()
    }
    vi.stubEnv('PUBLISHING_ENABLED', 'true')
    const first = makePost('Publiko vetëm një herë.')
    await queue(first)
    let writes = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        const path = url.pathname.split('/').pop()
        if (options?.method === 'POST') {
          writes++
          return new Response(JSON.stringify({ post_id: `${pageId}_post-1` }))
        }
        if (path === pageId) return new Response(JSON.stringify({ id: pageId }))
        if (path === `${pageId}_post-1`)
          return new Response(JSON.stringify({ id: `${pageId}_post-1` }))
        throw new Error(`Unexpected fixture URL: ${url.pathname}`)
      }),
    )
    await Promise.all([runPublishingBatch(), runPublishingBatch()])
    const firstJob = (
      await pool.query(
        'SELECT status,provider_post_id,failure_code FROM publication_jobs WHERE post_id=$1',
        [first.id],
      )
    ).rows[0]
    expect({ writes, ...firstJob }).toMatchObject({
      writes: 1,
      status: 'published',
      provider_post_id: `${pageId}_post-1`,
      failure_code: null,
    })
    const firstAttempts = await pool.query(
      'SELECT id,attempt_number,event_type,request_hash FROM publication_attempts WHERE post_id=$1 ORDER BY attempt_number,id',
      [first.id],
    )
    expect(
      firstAttempts.rows.map(({ attempt_number, event_type }) => ({ attempt_number, event_type })),
    ).toEqual([
      { attempt_number: 1, event_type: 'started' },
      { attempt_number: 1, event_type: 'published' },
    ])
    expect(new Set(firstAttempts.rows.map((attempt) => attempt.request_hash)).size).toBe(1)
    expect(firstAttempts.rows[0].request_hash).toMatch(/^[a-f0-9]{64}$/)
    await expect(
      pool.query("UPDATE publication_attempts SET failure_code='changed' WHERE id=$1", [
        firstAttempts.rows[0].id,
      ]),
    ).rejects.toMatchObject({ code: 'P0001' })
    await expect(
      pool.query('DELETE FROM publication_attempts WHERE id=$1', [firstAttempts.rows[0].id]),
    ).rejects.toMatchObject({ code: 'P0001' })

    const uncertain = makePost('Rezultati pas timeout-it.')
    await queue(uncertain)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        const path = url.pathname.split('/').pop()
        if (options?.method === 'POST') {
          writes++
          throw new Error('timeout after provider accepted the write')
        }
        if (path === pageId) return new Response(JSON.stringify({ id: pageId }))
        if (path === 'published_posts')
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: `${pageId}_post-2`,
                  message: uncertain.caption,
                  created_time: new Date().toISOString(),
                },
              ],
            }),
          )
        throw new Error(`Unexpected fixture URL: ${url.pathname}`)
      }),
    )
    await runPublishingBatch()
    expect(
      (await pool.query('SELECT status FROM publication_jobs WHERE post_id=$1', [uncertain.id]))
        .rows[0].status,
    ).toBe('uncertain')
    const reconciled = await reconcileUncertainPublication(uncertain.id, item.id)
    expect(reconciled).toMatchObject({ resolved: true, providerPostId: `${pageId}_post-2` })
    expect(
      (await pool.query('SELECT status FROM publication_jobs WHERE post_id=$1', [uncertain.id]))
        .rows[0].status,
    ).toBe('published')
    expect(
      (
        await pool.query(
          'SELECT event_type FROM publication_attempts WHERE post_id=$1 ORDER BY attempt_number,id',
          [uncertain.id],
        )
      ).rows.map((attempt) => attempt.event_type),
    ).toEqual(['started', 'uncertain', 'published'])
    expect(writes).toBe(2)
    vi.stubEnv('PUBLISHING_ENABLED', 'false')
  })

  it('retries an explicit rate-limit response with backoff and stops at the stored attempt limit', async () => {
    const item = await business()
    await organization(item)
    await grant(item.id, item.email, randomUUID())
    const assetId = randomUUID()
    const photo = await decodePhoto(
      await sharp({ create: { width: 800, height: 800, channels: 3, background: '#739276' } })
        .jpeg()
        .toBuffer(),
    )
    await pool.query(
      "INSERT INTO assets(id,business_id,name,tags,rights,mime,bytes,width,height,size_bytes) VALUES($1,$2,'Retry photo','[]',true,'image/jpeg',$3,800,800,octet_length($3::bytea))",
      [assetId, item.id, photo.data],
    )
    const pageId = 'retry-page-1'
    await pool.query(
      "INSERT INTO meta_connections(business_id,facebook_user_id,token_ciphertext,expires_at,scopes,status,page_id,page_name,page_token_ciphertext) VALUES($1,'retry-user',$2,now()+interval '1 day',$3,'connected',$4,'Retry page',$5)",
      [
        item.id,
        encryptMetaToken('retry-user-token', item.id),
        JSON.stringify(['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']),
        pageId,
        encryptMetaToken('retry-page-token', item.id),
      ],
    )
    const post: Post = {
      id: randomUUID(),
      title: 'Retry fixture',
      caption: 'Publikimi pret sipas udhëzimit të Meta-s.',
      status: 'scheduled',
      channel: 'Facebook',
      format: 'static',
      image: `/api/media/${assetId}`,
      pillar: 'Produkti',
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
      publicationMode: 'automatic',
      version: 2,
      contentVersion: 1,
      history: [],
      policy: 'pass',
      policyReason: '',
    }
    await pool.query(
      'INSERT INTO posts(id,business_id,payload,content_version) VALUES($1,$2,$3,1)',
      [post.id, item.id, JSON.stringify(post)],
    )
    await pool.query(
      "INSERT INTO publication_jobs(post_id,business_id,post_version,content_version,status,run_at,target_page_id,max_attempts) VALUES($1,$2,2,1,'pending',now()-interval '1 second',$3,3)",
      [post.id, item.id, pageId],
    )
    vi.stubEnv('PUBLISHING_ENABLED', 'true')
    const fetcher = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { code: 4, is_transient: true } }), {
          status: 429,
          headers: { 'Retry-After': '90' },
        }),
    )
    vi.stubGlobal('fetch', fetcher)

    await runPublishingBatch()
    let job = (
      await pool.query(
        'SELECT status,retry_count,max_attempts,failure_code,run_at>now() AS delayed FROM publication_jobs WHERE post_id=$1',
        [post.id],
      )
    ).rows[0]
    expect(job).toMatchObject({
      status: 'pending',
      retry_count: 1,
      max_attempts: 3,
      failure_code: 'meta_rate_limit_4',
      delayed: true,
    })

    for (let attempt = 0; attempt < 2; attempt++) {
      await pool.query(
        "UPDATE publication_jobs SET run_at=now()-interval '1 second' WHERE post_id=$1",
        [post.id],
      )
      await runPublishingBatch()
    }
    job = (
      await pool.query(
        'SELECT status,retry_count,max_attempts,failure_code FROM publication_jobs WHERE post_id=$1',
        [post.id],
      )
    ).rows[0]
    expect(job).toMatchObject({
      status: 'failed',
      retry_count: 2,
      max_attempts: 3,
      failure_code: 'retry_exhausted_rate_limit',
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls.every((call) => call[1]?.method === 'GET')).toBe(true)
    const attempts = await pool.query(
      'SELECT attempt_number,event_type,request_hash FROM publication_attempts WHERE post_id=$1 ORDER BY attempt_number,id',
      [post.id],
    )
    expect(
      attempts.rows.map(({ attempt_number, event_type }) => [attempt_number, event_type]),
    ).toEqual([
      [1, 'started'],
      [1, 'retry_scheduled'],
      [2, 'started'],
      [2, 'retry_scheduled'],
      [3, 'started'],
      [3, 'failed'],
    ])
    expect(new Set(attempts.rows.map((attempt) => attempt.request_hash)).size).toBe(1)
  })
})

describe('immutable post content and approvals', () => {
  it('keeps full snapshots immutable and never reuses approval for changed content', async () => {
    const item = await business()
    const other = await business()
    const post: Post = {
      id: randomUUID(),
      title: 'Versioni i parë',
      caption: 'Përmbajtja e parë.',
      status: 'approved',
      channel: 'Facebook',
      format: 'static',
      image: '/api/media/00000000-0000-4000-8000-000000000000',
      pillar: 'Produkti',
      scheduledAt: null,
      version: 2,
      contentVersion: 1,
      history: [],
      policy: 'pass',
      policyReason: '',
    }
    await pool.query(
      'INSERT INTO posts(id,business_id,payload,content_version) VALUES($1,$2,$3,1)',
      [post.id, item.id, JSON.stringify(post)],
    )
    await pool.query(
      "INSERT INTO post_content_versions(post_id,business_id,content_version,fingerprint,snapshot,source,actor_id) VALUES($1,$2,1,$3,$4,'editor',$5)",
      [
        post.id,
        item.id,
        postFingerprint(post),
        JSON.stringify(postContentSnapshot(post)),
        item.user,
      ],
    )
    await pool.query(
      "INSERT INTO post_approval_records(post_id,business_id,content_version,fingerprint,actor_id,decision,source) VALUES($1,$2,1,$3,$4,'approved','editor')",
      [post.id, item.id, postFingerprint(post), item.user],
    )
    await expect(requireCurrentApproval(post, item.id, pool)).resolves.toBeUndefined()

    await expect(
      pool.query(
        "INSERT INTO post_content_versions(post_id,business_id,content_version,fingerprint,snapshot,source,actor_id) VALUES($1,$2,2,$3,$4,'editor',$5)",
        [
          post.id,
          other.id,
          postFingerprint(post),
          JSON.stringify({ ...postContentSnapshot(post), contentVersion: 2 }),
          other.user,
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' })

    const changed: Post = {
      ...post,
      caption: 'Përmbajtja e dytë.',
      status: 'draft',
      version: 3,
      contentVersion: 2,
    }
    await pool.query('UPDATE posts SET payload=$1,content_version=2 WHERE id=$2', [
      JSON.stringify(changed),
      post.id,
    ])
    await pool.query(
      "INSERT INTO post_content_versions(post_id,business_id,content_version,fingerprint,snapshot,source,actor_id) VALUES($1,$2,2,$3,$4,'editor',$5)",
      [
        post.id,
        item.id,
        postFingerprint(changed),
        JSON.stringify(postContentSnapshot(changed)),
        item.user,
      ],
    )
    await expect(requireCurrentApproval(changed, item.id, pool)).rejects.toMatchObject({
      statusCode: 422,
    })
    await expect(
      pool.query(
        "UPDATE post_content_versions SET snapshot='{}' WHERE post_id=$1 AND content_version=1",
        [post.id],
      ),
    ).rejects.toMatchObject({ code: 'P0001' })
    const original = await pool.query(
      'SELECT snapshot FROM post_content_versions WHERE post_id=$1 AND content_version=1',
      [post.id],
    )
    expect(original.rows[0].snapshot).toEqual(postContentSnapshot(post))
  })
})

describe('Meta transport and token security', () => {
  it('classifies provider failures and bounds retry timing', () => {
    expect(metaFailureCategory(429, 4)).toBe('rate_limit')
    expect(metaFailureCategory(401, 190)).toBe('authentication')
    expect(metaFailureCategory(403, 200)).toBe('permission')
    expect(metaFailureCategory(400, 36003)).toBe('media')
    expect(metaFailureCategory(500, 500)).toBe('server')
    expect(parseRetryAfter('120')).toBe(120)
    expect(parseRetryAfter(new Date(Date.now() + 30_000).toUTCString())).toBeGreaterThanOrEqual(29)
    expect(parseRetryAfter('999999')).toBe(3600)
    expect(publishingMaxAttempts('7')).toBe(7)
    expect(publishingMaxAttempts('0')).toBe(5)

    const jobId = randomUUID()
    const first = publicationRetryDelaySeconds(jobId, 0)
    const third = publicationRetryDelaySeconds(jobId, 2)
    expect(first).toBeGreaterThanOrEqual(24)
    expect(first).toBeLessThanOrEqual(36)
    expect(third).toBeGreaterThanOrEqual(96)
    expect(third).toBeLessThanOrEqual(144)
    expect(publicationRetryDelaySeconds(jobId, 0, 300)).toBe(300)
    expect(
      publicationFailureCode(
        new MetaFailure(4, true, undefined, {
          category: 'rate_limit',
          safeToRetry: true,
        }),
      ),
    ).toBe('meta_rate_limit_4')
    expect(publicationFailureDisposition('pending', 'meta_rate_limit_4')).toBe('retryable')
    expect(publicationFailureDisposition('failed', 'meta_authentication_190')).toBe('blocked')
    expect(publicationFailureDisposition('failed', 'meta_permission_200')).toBe('blocked')
    expect(publicationFailureDisposition('failed', 'meta_media_36003')).toBe('terminal')
    expect(publicationRemediation('meta_authentication_190')).toContain('Rilidhe')
  })

  it('binds encrypted tokens to their business and detects modification', () => {
    const envelope = encryptMetaToken('private-access-token', 'business-a')
    expect(envelope).not.toContain('private-access-token')
    expect(decryptMetaToken(envelope, 'business-a')).toBe('private-access-token')
    expect(() => decryptMetaToken(envelope, 'business-b')).toThrow()
    const parts = envelope.split('.')
    parts[1] = Buffer.alloc(16, 1).toString('base64url')
    expect(() => decryptMetaToken(parts.join('.'), 'business-a')).toThrow()
  })
  it('sends tokens in headers, rejects caller hosts and sanitizes provider errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] })))
    vi.stubGlobal('fetch', fetcher)
    await graphRequest('me/accounts', 'private-token', { fields: 'id' })
    const [url, options] = fetcher.mock.calls[0]!
    expect(url.toString()).toMatch(/^https:\/\/graph.facebook.com\/v26.0\/me\/accounts\?/)
    expect(url.toString()).not.toContain('private-token')
    expect(options.headers.Authorization).toBe('Bearer private-token')
    expect(options.redirect).toBe('error')
    await expect(graphRequest('https://evil.test', 'private-token')).rejects.toThrow(
      'Invalid Graph path',
    )
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 190, message: 'private-token' } }), {
        status: 400,
      }),
    )
    await expect(graphRequest('me', 'private-token')).rejects.toBeInstanceOf(MetaFailure)
    await expect(graphRequest('me', 'private-token')).rejects.not.toThrow('private-token')
  })
  it('honors Retry-After and only retries provider calls with a known-safe outcome', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 4, is_transient: true } }), {
          status: 429,
          headers: { 'Retry-After': '90' },
        }),
      ),
    )
    const rateLimit = await graphRequest('me', 'private-token').catch((error) => error)
    expect(rateLimit).toMatchObject({
      code: 4,
      retryable: true,
      category: 'rate_limit',
      retryAfterSeconds: 90,
      safeToRetry: true,
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    const safeRead = await graphRequest('me', 'private-token').catch((error) => error)
    const uncertainWrite = await graphRequest('123/photos', 'private-token', {}, 'POST').catch(
      (error) => error,
    )
    expect(safeRead).toMatchObject({ category: 'network', safeToRetry: true })
    expect(uncertainWrite).toMatchObject({ category: 'network', safeToRetry: false })

    for (const fixture of [
      {
        status: 503,
        body: { error: { code: 2, is_transient: true } },
        expected: { category: 'server', retryable: true, safeToRetry: true },
      },
      {
        status: 401,
        body: { error: { code: 190 } },
        expected: { category: 'authentication', retryable: false, safeToRetry: false },
      },
      {
        status: 403,
        body: { error: { code: 200 } },
        expected: { category: 'permission', retryable: false, safeToRetry: false },
      },
      {
        status: 400,
        body: { error: { code: 36003 } },
        expected: { category: 'media', retryable: false, safeToRetry: false },
      },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify(fixture.body), { status: fixture.status }),
          ),
      )
      await expect(graphRequest('me', 'private-token')).rejects.toMatchObject(fixture.expected)
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 2, is_transient: true } }), {
          status: 503,
        }),
      ),
    )
    await expect(graphRequest('123/photos', 'private-token', {}, 'POST')).rejects.toMatchObject({
      category: 'server',
      retryable: true,
      safeToRetry: false,
    })
  })
  it('rejects forged, expired and excessively long media grants', () => {
    const expires = String(Math.floor(Date.now() / 1000) + 600),
      id = randomUUID()
    expect(validMediaSignature(id, expires, mediaSignature(id, expires))).toBe(true)
    expect(validMediaSignature(randomUUID(), expires, mediaSignature(id, expires))).toBe(false)
    const expired = String(Math.floor(Date.now() / 1000) - 1)
    expect(validMediaSignature(id, expired, mediaSignature(id, expired))).toBe(false)
    const far = String(Math.floor(Date.now() / 1000) + 3600)
    expect(validMediaSignature(id, far, mediaSignature(id, far))).toBe(false)
  })
})

describe('monthly planning persistence and cost boundaries', () => {
  function configurePlanner() {
    vi.stubEnv('AI_MONTHLY_PLANNER_ENABLED', 'true')
    vi.stubEnv('OPENAI_API_KEY', 'fixture-only-no-network')
    vi.stubEnv('AI_PLANNER_MODEL', 'fixture-model')
    vi.stubEnv('AI_IMAGE_MODEL', 'fixture-image-model')
    vi.stubEnv('AI_IMAGE_QUALITY', 'high')
    vi.stubEnv('AI_IMAGE_RESERVE_MICRO_EUR', '1000000')
    vi.stubEnv('AI_USD_MICRO_EUR', '1000000')
    vi.stubEnv('AI_PLANNER_INPUT_MICRO_EUR_PER_MILLION_TOKENS', '1000000')
    vi.stubEnv('AI_PLANNER_OUTPUT_MICRO_EUR_PER_MILLION_TOKENS', '2000000')
    vi.stubEnv('AI_WEB_SEARCH_MICRO_EUR_PER_CALL', '10000')
    vi.stubEnv('AI_PLANNER_MONTHLY_BUDGET_MICRO_EUR', '100000000')
    vi.stubEnv('AI_DAILY_BUDGET_MICRO_EUR', '100000000')
  }
  async function monthlyBusiness(count = 2) {
    configurePlanner()
    const item = await business()
    const workspace = createDemo()
    workspace.posts = []
    workspace.assets = []
    workspace.revision = 0
    await pool.query('UPDATE businesses SET state=$1 WHERE id=$2', [
      JSON.stringify(workspace),
      item.id,
    ])
    await pool.query(
      "INSERT INTO entitlements(business_id,valid_from,valid_until,features,source,plan_name,plan_version,limits) VALUES($1,now()-interval '1 day',now()+interval '3 months','[\"posts\",\"media\",\"ai\",\"validation\"]','test','Fixture',1,$2)",
      [
        item.id,
        JSON.stringify({
          posts_per_month: count,
          ai_requests_per_day: 100,
          media_storage_bytes: 10000000,
          social_accounts: 2,
          members: 1,
        }),
      ],
    )
    const assetId = randomUUID()
    const bytes = await sharp({
      create: { width: 800, height: 800, channels: 3, background: '#215040' },
    })
      .jpeg()
      .toBuffer()
    await pool.query(
      "INSERT INTO assets(id,business_id,name,tags,rights,mime,bytes,width,height) VALUES($1,$2,'Owned test photo','[]',true,'image/jpeg',$3,800,800)",
      [assetId, item.id, bytes],
    )
    await pool.query(
      `INSERT INTO monthly_planner_settings(
         business_id,enabled,photo_mode,preferred_asset_ids,configured_at
       ) VALUES($1,true,'selected',$2,now())
       ON CONFLICT(business_id) DO UPDATE SET
         enabled=EXCLUDED.enabled,
         photo_mode=EXCLUDED.photo_mode,
         preferred_asset_ids=EXCLUDED.preferred_asset_ids,
         configured_at=EXCLUDED.configured_at,
         updated_at=now()`,
      [item.id, [assetId]],
    )
    const next = new Date()
    next.setUTCDate(1)
    next.setUTCMonth(next.getUTCMonth() + 1)
    return { ...item, assetId, month: next.toISOString().slice(0, 7) }
  }
  async function enqueue(item: Awaited<ReturnType<typeof monthlyBusiness>>) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await ensureMonthlyPlan(client, item.id, item.user, item.month)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  async function restart(item: Awaited<ReturnType<typeof monthlyBusiness>>) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await restartMonthlyPlan(client, item.id, item.user, item.month)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  it('queues one monthly job under concurrent requests and scopes reads with RLS', async () => {
    const item = await monthlyBusiness()
    const [first, second] = await Promise.all([enqueue(item), enqueue(item)])
    expect(second.id).toBe(first.id)
    const other = await business()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL ROLE app_runtime')
      await setTenantContext(client, { userId: other.user, organizationId: other.id })
      expect(
        (await client.query('SELECT id FROM monthly_plans WHERE id=$1', [first.id])).rows,
      ).toEqual([])
      expect(
        (await client.query("UPDATE monthly_plans SET status='cancelled' WHERE id=$1", [first.id]))
          .rowCount,
      ).toBe(0)
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
    await pool.query("UPDATE monthly_plans SET status='cancelled' WHERE id=$1", [first.id])
  })
  it('uses the paid package that covers the complete future planning month', async () => {
    const item = await monthlyBusiness(7)
    const start = new Date(`${item.month}-01T00:00:00.000Z`)
    const end = new Date(start)
    end.setUTCMonth(end.getUTCMonth() + 1)
    await pool.query(
      `UPDATE entitlements
          SET valid_from=now()-interval '1 day',valid_until=$2,
              limits=jsonb_set(limits,'{posts_per_month}','7'::jsonb)
        WHERE business_id=$1`,
      [item.id, end],
    )
    const plan = await enqueue(item)
    const stored = (
      await pool.query('SELECT target_count,entitlement_snapshot FROM monthly_plans WHERE id=$1', [
        plan.id,
      ])
    ).rows[0]
    expect(stored.target_count).toBe(7)
    expect(stored.entitlement_snapshot).toMatchObject({
      paid: true,
      limits: { posts_per_month: 7 },
    })
    await pool.query("UPDATE monthly_plans SET status='cancelled' WHERE id=$1", [plan.id])
  })
  it('does not prepare future drafts beyond the entitlement expiry', async () => {
    const item = await monthlyBusiness()
    await pool.query(
      `UPDATE entitlements
          SET valid_from=$2::date,valid_until=$2::date+interval '15 days'
        WHERE business_id=$1`,
      [item.id, `${item.month}-01`],
    )
    await expect(enqueue(item)).rejects.toThrow('ENTITLEMENT_REQUIRED')
  })
  it('restarts a zero-draft blocked plan from new evidence without reusing paid stages', async () => {
    const item = await monthlyBusiness()
    const plan = await enqueue(item)
    const before = (
      await pool.query('SELECT evidence_hash FROM monthly_plans WHERE id=$1', [plan.id])
    ).rows[0].evidence_hash as string
    await pool.query(
      "INSERT INTO monthly_ai_runs(plan_id,business_id,stage_key,model,prompt_version,prompt_hash,status,reserved_cost_micro_eur,actual_cost_micro_eur,result,completed_at) VALUES($1,$2,$3,'fixture','fixture','fixture','completed',1,1,'{}',now())",
      [plan.id, item.id, `research:${before}`],
    )
    await pool.query(
      "UPDATE businesses SET state=jsonb_set(state,'{brand,voice}','\"Updated brand voice\"'::jsonb) WHERE id=$1",
      [item.id],
    )
    await pool.query(
      "UPDATE monthly_plans SET status='blocked',error_code='EVIDENCE_CHANGED' WHERE id=$1",
      [plan.id],
    )
    await expect(restart(item)).resolves.toMatchObject({ id: plan.id, status: 'queued' })
    const rebuilt = (
      await pool.query(
        'SELECT status,stage,completed_count,evidence_hash,research,editorial_plan,error_code FROM monthly_plans WHERE id=$1',
        [plan.id],
      )
    ).rows[0]
    expect(rebuilt).toMatchObject({
      status: 'queued',
      stage: 'research',
      completed_count: 0,
      research: null,
      editorial_plan: null,
      error_code: null,
    })
    expect(rebuilt.evidence_hash).not.toBe(before)
    expect(
      (
        await pool.query('SELECT id FROM monthly_ai_runs WHERE plan_id=$1 AND stage_key=$2', [
          plan.id,
          `research:${before}`,
        ])
      ).rowCount,
    ).toBe(1)
    await pool.query("UPDATE monthly_plans SET status='blocked',completed_count=1 WHERE id=$1", [
      plan.id,
    ])
    await expect(restart(item)).rejects.toThrow('PLAN_HAS_DRAFTS')
    await pool.query("UPDATE monthly_plans SET status='cancelled' WHERE id=$1", [plan.id])
  })
  it('recovers one ambiguous paid call and then stops duplicate spend', async () => {
    const item = await monthlyBusiness()
    const plan = await enqueue(item)
    const fetcher = vi.fn().mockRejectedValue(new Error('connection lost after send'))
    vi.stubGlobal('fetch', fetcher)
    const args = {
      planId: plan.id,
      businessId: item.id,
      stageKey: 'research',
      capability: 'research' as const,
      input: {},
      maxOutput: 100,
    }
    await expect(monthlyProviderCall(pool, args)).rejects.toThrow('PROVIDER_UNCERTAIN')
    await expect(monthlyProviderCall(pool, args)).rejects.toThrow('PROVIDER_UNCERTAIN')
    await expect(monthlyProviderCall(pool, args)).rejects.toThrow('PROVIDER_RETRY_EXHAUSTED')
    expect(fetcher).toHaveBeenCalledTimes(2)
    const ledger = await pool.query(
      'SELECT status,reserved_cost_micro_eur,stage_key FROM monthly_ai_runs WHERE plan_id=$1 ORDER BY created_at',
      [plan.id],
    )
    expect(ledger.rowCount).toBe(2)
    expect(ledger.rows.every((row) => row.status === 'uncertain')).toBe(true)
    expect(ledger.rows[0].stage_key).toContain(':uncertain:')
    expect(ledger.rows[1].stage_key).toBe('research')
    expect(ledger.rows.every((row) => Number(row.reserved_cost_micro_eur) > 0)).toBe(true)
    await pool.query("UPDATE monthly_plans SET status='cancelled' WHERE id=$1", [plan.id])
  })
  it('allows the dedicated worker to advance a plan but cannot delete planner records', async () => {
    const item = await monthlyBusiness(1)
    const plan = await enqueue(item)
    const url = 'https://example.test/worker-source'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'worker-research-fixture',
            status: 'completed',
            usage: { input_tokens: 100, output_tokens: 100 },
            output: [
              {
                type: 'web_search_call',
                status: 'completed',
                action: { sources: [{ url, title: 'Worker source' }] },
              },
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: 'Market context [1]',
                    annotations: [
                      {
                        type: 'url_citation',
                        url,
                        title: 'Worker source',
                        start_index: 15,
                        end_index: 18,
                      },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    const worker = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public -c role=rrit_worker`,
    })
    try {
      expect((await worker.query('SELECT current_user')).rows[0].current_user).toBe('rrit_worker')
      await runMonthlyPlannerTick(worker, { discover: false })
      expect(
        (await pool.query('SELECT status,stage,research FROM monthly_plans WHERE id=$1', [plan.id]))
          .rows[0],
      ).toMatchObject({ status: 'running', stage: 'planning' })
      expect(
        (await pool.query('SELECT research FROM monthly_plans WHERE id=$1', [plan.id])).rows[0]
          .research.sources,
      ).toEqual([{ url, title: 'Worker source' }])
      await expect(
        worker.query('DELETE FROM monthly_plans WHERE id=$1', [plan.id]),
      ).rejects.toMatchObject({
        code: '42501',
      })
    } finally {
      await worker.end()
    }
    await pool.query("UPDATE monthly_plans SET status='cancelled' WHERE id=$1", [plan.id])
  })
  it('rejects a cost reservation before any provider request', async () => {
    const item = await monthlyBusiness()
    const plan = await enqueue(item)
    vi.stubEnv('AI_DAILY_BUDGET_MICRO_EUR', '1')
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(
      monthlyProviderCall(pool, {
        planId: plan.id,
        businessId: item.id,
        stageKey: 'research',
        capability: 'research',
        input: {},
        maxOutput: 100,
      }),
    ).rejects.toThrow('BUDGET_EXCEEDED')
    expect(fetcher).not.toHaveBeenCalled()
    expect(
      (await pool.query('SELECT id FROM monthly_ai_runs WHERE plan_id=$1', [plan.id])).rowCount,
    ).toBe(0)
    await pool.query("UPDATE monthly_plans SET status='cancelled' WHERE id=$1", [plan.id])
  })
  it('runs research, strategy, two creatives and QA into editable drafts without publishing', async () => {
    const item = await monthlyBusiness()
    await pool.query(
      "UPDATE businesses SET state=jsonb_set(state,'{brand,facts,1}',(state#>'{brand,facts,1}') || $2::jsonb) WHERE id=$1",
      [
        item.id,
        JSON.stringify({
          kind: 'offer',
          validFrom: `${item.month}-01`,
          validUntil: `${item.month}-20`,
        }),
      ],
    )
    const plan = await enqueue(item)
    const url = 'https://example.test/primary-local-source'
    const generatedBase = await sharp({
      create: { width: 768, height: 1024, channels: 3, background: '#284f42' },
    })
      .jpeg()
      .toBuffer()
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      if (_url.includes('/images/'))
        return new Response(
          JSON.stringify({
            created: 1,
            data: [{ b64_json: generatedBase.toString('base64'), media_type: 'image/jpeg' }],
          }),
          { status: 200 },
        )
      const body = JSON.parse(init.body as string)
      const input = JSON.parse(body.input[0].content[0].text)
      let value: unknown
      if (body.tools)
        return new Response(
          JSON.stringify({
            id: 'research-fixture',
            status: 'completed',
            usage: { input_tokens: 100, output_tokens: 100 },
            output: [
              {
                type: 'web_search_call',
                status: 'completed',
                action: { sources: [{ url, title: 'Fixture primary source' }] },
              },
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: 'Context [1]',
                    annotations: [
                      {
                        type: 'url_citation',
                        url,
                        title: 'Fixture primary source',
                        start_index: 8,
                        end_index: 11,
                      },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        )
      if (body.text.format.name === 'planning')
        value = {
          objective: 'Present the real business offering',
          audience: 'People in the local neighborhood',
          rationale: 'Combine useful product stories and local context.',
          slots: [10, 20].map((day, index) => ({
            day,
            time: '10:00',
            channel: 'Instagram',
            topic: index ? 'A neighborhood coffee question' : 'A useful coffee story',
            pillar: index ? 'Community' : 'Product',
            intent: index ? 'conversation' : 'educate',
            hook: index
              ? 'Which coffee moment belongs to you?'
              : 'What is behind the daily ritual?',
            purpose: index
              ? 'Invite a meaningful preference-based conversation.'
              : 'Introduce a verified offering in context.',
            assetDirection:
              'Use an owned photograph whose subject supports this exact story angle.',
            visualLayout: index ? 'immersive' : 'magazine',
            algorithmGoal: index ? 'meaningful_comments' : 'saves',
            platformRationale: index
              ? 'Instagram supports a visual question designed for meaningful comments.'
              : 'Instagram supports a useful visual story that people can save.',
            timingRationale: 'This time is a hypothesis to test against account-level Insights.',
            factIds: ['f2'],
            sourceUrls: [url],
            requiredAssetId: null,
          })),
        }
      else if (body.text.format.name === 'content')
        value = {
          title: `Kafe në lagje ${input.slot.day}`,
          caption: `Kafe dhe ëmbëlsira në lagje. Na vizito! Dita ${input.slot.day}.`,
          hashtags: ['#Kafe', '#LagjjaJonë'],
          assetId: item.assetId,
          assetReason: 'The owned photo has space for a clean editorial composition.',
          factIds: ['f2'],
          creative: {
            headline: 'Koha për një kafe',
            eyebrow: 'Në lagjen tënde',
            cta: 'Na vizito',
            layout: input.slot.visualLayout,
          },
          reasoning: {
            concept: 'The concept connects a verified product with a familiar local ritual.',
            copy: 'The concise copy opens with the product and closes with one clear invitation.',
            design:
              'The selected hierarchy preserves the photograph while keeping the message readable.',
            hashtags: 'The two focused hashtags describe the product and its local context.',
          },
        }
      else
        value = {
          decision: 'PASS',
          reasons: ['Fixture reviewer passed the supplied content.'],
          factuality: true,
          brandFit: true,
          visualQuality: true,
        }
      return new Response(
        JSON.stringify({
          id: randomUUID(),
          status: 'completed',
          usage: { input_tokens: 100, output_tokens: 100 },
          output: [
            { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
          ],
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetcher)
    for (let stage = 0; stage < 5; stage++) await runMonthlyPlannerTick(pool, { discover: false })
    const finished = (
      await pool.query(
        'SELECT status,stage,completed_count,error_code FROM monthly_plans WHERE id=$1',
        [plan.id],
      )
    ).rows[0]
    expect(finished).toMatchObject({
      status: 'review',
      stage: 'complete',
      completed_count: 2,
      error_code: null,
    })
    const posts = await pool.query(
      'SELECT payload FROM posts WHERE monthly_plan_id=$1 ORDER BY monthly_slot',
      [plan.id],
    )
    expect(posts.rowCount).toBe(2)
    for (const { payload } of posts.rows) {
      expect(payload).toMatchObject({
        status: 'draft',
        scheduledAt: null,
        publicationMode: 'manual',
        contentVersion: 1,
      })
      expect(payload.proposedAt).toContain(item.month)
      expect(payload.aiProvenance.sourceUrls).toEqual([url])
      expect(payload.aiProvenance.reasoning).toMatchObject({
        concept: expect.any(String),
        design: expect.any(String),
        hashtags: expect.any(String),
      })
      expect(payload.caption).toContain('#Kafe #LagjjaJonë')
      expect((await localPostChecks(payload, item.id, pool)).every((check) => check.passed)).toBe(
        true,
      )
    }
    expect(fetcher).toHaveBeenCalledTimes(8)
    await runMonthlyPlannerTick(pool, { discover: false })
    expect(fetcher).toHaveBeenCalledTimes(8)
    expect(
      (await pool.query('SELECT id FROM publication_jobs WHERE business_id=$1', [item.id]))
        .rowCount,
    ).toBe(0)
    expect(
      (
        await pool.query('SELECT post_id FROM post_content_versions WHERE business_id=$1', [
          item.id,
        ])
      ).rowCount,
    ).toBe(2)
    const edited = {
      ...posts.rows[0].payload,
      title: 'Version i redaktuar',
      caption: 'Kafe dhe ëmbëlsira për klientët e lagjes.',
      image: `/api/media/${item.assetId}`,
      contentVersion: 2,
      version: 2,
    }
    await pool.query('UPDATE posts SET payload=$1,content_version=2 WHERE id=$2', [
      JSON.stringify(edited),
      edited.id,
    ])
    expect(
      (await localPostChecks(edited, item.id, pool)).find((check) => check.key === 'ai_quality')
        ?.passed,
    ).toBe(false)
    const runtime = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public -c role=app_runtime`,
    })
    try {
      const tenant = { userId: item.user, organizationId: item.id }
      await expect(
        reviewPostQuality(runtime, { ...tenant, userId: randomUUID() }, edited.id, 2),
      ).rejects.toThrow('POST_NOT_FOUND')
      const reviewed = await reviewPostQuality(runtime, tenant, edited.id, 2)
      expect(reviewed.quality.decision).toBe('PASS')
      expect(fetcher).toHaveBeenCalledTimes(7)
      await reviewPostQuality(runtime, tenant, edited.id, 2)
      expect(fetcher).toHaveBeenCalledTimes(7)
      await expect(
        currentPostQuality(runtime, { ...tenant, userId: randomUUID() }, edited.id),
      ).rejects.toThrow('POST_NOT_FOUND')
      const storedReview = await currentPostQuality(runtime, tenant, edited.id)
      expect(storedReview).toMatchObject({ contentVersion: 2, quality: { decision: 'PASS' } })
      expect(storedReview.reviewedAt).toMatch(/^20\d\d-/)
      expect(
        (await localPostChecks(edited, item.id, pool)).find((check) => check.key === 'ai_quality')
          ?.passed,
      ).toBe(true)
      const changed = {
        ...edited,
        caption: 'Një tekst tjetër pas kontrollit.',
        contentVersion: 3,
        version: 3,
      }
      await pool.query('UPDATE posts SET payload=$1,content_version=3 WHERE id=$2', [
        JSON.stringify(changed),
        edited.id,
      ])
      expect((await currentPostQuality(runtime, tenant, edited.id)).quality).toBeNull()
      expect(
        (await localPostChecks(changed, item.id, pool)).find((check) => check.key === 'ai_quality')
          ?.passed,
      ).toBe(false)
      const realFixture = fetcher.getMockImplementation()!
      fetcher.mockImplementationOnce(async (url, init) => {
        // A concurrent editor wins while the provider is in flight.
        await pool.query('UPDATE posts SET payload=$1,content_version=4 WHERE id=$2', [
          JSON.stringify({ ...changed, title: 'Ndryshim paralel', contentVersion: 4 }),
          edited.id,
        ])
        return realFixture(url, init)
      })
      await expect(reviewPostQuality(runtime, tenant, edited.id, 3)).rejects.toThrow('POST_CHANGED')
      const afterRace = (await pool.query('SELECT payload FROM posts WHERE id=$1', [edited.id]))
        .rows[0].payload
      expect(afterRace.title).toBe('Ndryshim paralel')
      expect(
        (await localPostChecks(afterRace, item.id, pool)).find(
          (check) => check.key === 'ai_quality',
        )?.passed,
      ).toBe(false)
    } finally {
      await runtime.end()
    }
    // A delayed publisher must use today's validity, not just the old planned day.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(`${item.month}-21T12:00:00Z`))
      const delayed = { ...posts.rows[0].payload, scheduledAt: posts.rows[0].payload.proposedAt }
      expect(
        (await localPostChecks(delayed, item.id, pool)).find((check) => check.key === 'ai_evidence')
          ?.passed,
      ).toBe(false)
    } finally {
      vi.useRealTimers()
    }
    await pool.query('UPDATE assets SET rights=false WHERE id=$1', [item.assetId])
    expect(
      (await localPostChecks(posts.rows[0].payload, item.id, pool)).find(
        (check) => check.key === 'ai_evidence',
      )?.passed,
    ).toBe(false)
  }, 30000)
})
