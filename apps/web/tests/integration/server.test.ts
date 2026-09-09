import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
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
  for (const file of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort())
    await pool.query(await readFile(new URL(file, directory), 'utf8'))
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
    expect(before.limits).toMatchObject({ posts_per_month: 60, social_accounts: 2, members: 1 })
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
    expect(plans.every((plan) => plan.currency === 'EUR' && plan.version === 1)).toBe(true)
    expect(plans.find((plan) => plan.name === 'Fillimi')?.limits.posts_per_month).toBe(12)
    expect(plans.find((plan) => plan.name === 'Përditë')?.entitlements).toContain('ai')
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
      "INSERT INTO assets(id,business_id,name,tags,rights,mime,bytes,width,height) VALUES($1,$2,'Photo','[]',true,'image/jpeg',$3,800,800)",
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
    await grant(item.id, item.email, randomUUID())
    const assetId = randomUUID()
    const photo = await decodePhoto(
      await sharp({ create: { width: 800, height: 800, channels: 3, background: '#739276' } })
        .jpeg()
        .toBuffer(),
    )
    await pool.query(
      "INSERT INTO assets(id,business_id,name,tags,rights,mime,bytes,width,height) VALUES($1,$2,'Worker photo','[]',true,'image/jpeg',$3,800,800)",
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
    await grant(item.id, item.email, randomUUID())
    const assetId = randomUUID()
    const photo = await decodePhoto(
      await sharp({ create: { width: 800, height: 800, channels: 3, background: '#739276' } })
        .jpeg()
        .toBuffer(),
    )
    await pool.query(
      "INSERT INTO assets(id,business_id,name,tags,rights,mime,bytes,width,height) VALUES($1,$2,'Retry photo','[]',true,'image/jpeg',$3,800,800)",
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
