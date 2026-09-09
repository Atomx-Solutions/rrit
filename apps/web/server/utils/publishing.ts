import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { postSchema, type Post } from '../../shared/schemas/workspace'
import {
  localPostChecks,
  postContentVersion,
  providerPostChecks,
} from './post-validation'
import { requireEntitlement, trialStatus } from './trials'
import {
  connectedMeta,
  decryptMetaToken,
  graphRequest,
  MetaFailure,
  metaConfigured,
} from './meta'

export async function requirePublishingWorker(db: Pool | PoolClient = database()) {
  if (!metaConfigured() || process.env.PUBLISHING_ENABLED !== 'true')
    throw createError({
      statusCode: 503,
      message: 'Publikimi në Meta ende nuk është aktivizuar nga platforma.',
    })
  const heartbeat = await db.query(
    "SELECT name FROM worker_heartbeats WHERE name='publisher' AND last_seen_at>now()-interval '2 minutes'",
  )
  if (!heartbeat.rows.length)
    throw createError({
      statusCode: 503,
      message:
        'Shërbimi i publikimit është përkohësisht i padisponueshëm. Drafti yt mbetet i ruajtur.',
    })
}
function mediaKey() {
  const key = process.env.MEDIA_SIGNING_KEY
  if (!key || key.length < 32)
    throw createError({ statusCode: 503, message: 'Shërbimi i fotografive nuk është konfiguruar.' })
  return key
}
export function mediaSignature(id: string, expires: string) {
  return createHmac('sha256', mediaKey()).update(`${id}:${expires}`).digest('hex')
}
export function validMediaSignature(id: string, expires: string, signature: string) {
  if (!/^\d{10}$/.test(expires) || !/^[a-f0-9]{64}$/.test(signature)) return false
  const now = Math.floor(Date.now() / 1000)
  if (Number(expires) < now || Number(expires) > now + 900) return false
  return timingSafeEqual(Buffer.from(signature), Buffer.from(mediaSignature(id, expires)))
}
export function publicMediaUrl(image: string) {
  const id = /^\/api\/media\/([a-f0-9-]{36})$/i.exec(image)?.[1]
  const origin = new URL(process.env.APP_URL!)
  if (!id || origin.protocol !== 'https:')
    throw createError({ statusCode: 503, message: 'Fotografia kërkon një adresë publike HTTPS.' })
  const expires = String(Math.floor(Date.now() / 1000) + 900)
  const url = new URL(`/api/publishing-media/${id}`, origin)
  url.search = new URLSearchParams({ expires, signature: mediaSignature(id, expires) }).toString()
  return url.href
}
export async function queuePublication(
  client: PoolClient,
  post: Post,
  businessId: string,
  runAt: string,
  logicalKey = publicationLogicalKey(businessId, post.id, post.version),
) {
  if (post.publicationMode !== 'automatic')
    throw createError({
      statusCode: 422,
      message: 'Konfirmo publikimin automatik për ta dërguar postimin në Meta.',
    })
  const access = await trialStatus(businessId, client)
  if (!access.paid && (!access.expiresAt || Date.parse(runAt) >= Date.parse(access.expiresAt)))
    throw createError({
      statusCode: 422,
      message: 'Zgjidh një orar brenda periudhës aktive të trial-it.',
    })
  const connection = await client.query(
    "SELECT page_id,instagram_id FROM meta_connections WHERE business_id=$1 AND status='connected' AND expires_at>$2",
    [businessId, runAt],
  )
  if (!connection.rows[0])
    throw createError({
      statusCode: 422,
      message: 'Lidhja me Meta duhet të jetë e vlefshme deri në orarin e publikimit.',
    })
  const queued = await client.query(
    `INSERT INTO publication_jobs
       (post_id,business_id,post_version,content_version,status,run_at,target_page_id,target_instagram_id,max_attempts,logical_key)
     VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9)
     ON CONFLICT (business_id,logical_key) DO UPDATE SET logical_key=EXCLUDED.logical_key
     RETURNING id,status`,
    [
      post.id,
      businessId,
      post.version,
      postContentVersion(post),
      runAt,
      connection.rows[0].page_id,
      connection.rows[0].instagram_id,
      publishingMaxAttempts(),
      logicalKey,
    ],
  )
  return { id: queued.rows[0].id as string, status: queued.rows[0].status as string }
}
type Job = {
  id: string
  post_id: string
  business_id: string
  post_version: number
  content_version: number
  provider_container_id: string | null
  provider_post_id: string | null
  target_page_id: string
  target_instagram_id: string | null
  container_started_at: Date | null
  run_at: Date
  created_at: Date
  retry_count: number
  max_attempts: number
  attempt_count: number
}
type ProviderPublication = {
  id: string
  message?: string
  caption?: string
  created_time?: string
  timestamp?: string
}
export function reconnectionMatchesTargets(
  jobs: { status: string; target_page_id: string; target_instagram_id: string | null }[],
  pageId: string,
  instagramId: string | null,
) {
  return jobs.every(
    (job) =>
      job.status === 'uncertain' &&
      job.target_page_id === pageId &&
      (!job.target_instagram_id || job.target_instagram_id === instagramId),
  )
}
export function uniquePublicationMatch(
  candidates: ProviderPublication[],
  post: Post,
  runAt: Date,
) {
  const earliest = runAt.getTime() - 5 * 60 * 1000
  const matches = candidates.filter((candidate) => {
    const text = candidate.message ?? candidate.caption ?? ''
    const publishedAt = Date.parse(candidate.created_time ?? candidate.timestamp ?? '')
    return text.trim() === post.caption.trim() && publishedAt >= earliest
  })
  return matches.length === 1 ? matches[0] : null
}
export function instagramContainerTimedOut(startedAt: Date, now = Date.now()) {
  return now - startedAt.getTime() > 3600000
}

export function publishingMaxAttempts(value = process.env.PUBLISHING_MAX_ATTEMPTS) {
  const parsed = Number(value || 5)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : 5
}

export function publicationRetryDelaySeconds(
  jobId: string,
  retryCount: number,
  retryAfterSeconds?: number,
) {
  const exponent = Math.min(Math.max(retryCount, 0), 6)
  const base = Math.min(30 * 2 ** exponent, 1800)
  const digest = createHash('sha256').update(`${jobId}:${retryCount}`).digest()
  const unit = digest.readUInt32BE(0) / 0xffffffff
  const jittered = Math.max(1, Math.round(base * (0.8 + unit * 0.4)))
  return Math.min(Math.max(jittered, retryAfterSeconds || 0), 3600)
}

export function publicationFailureCode(error: unknown) {
  if (error instanceof MetaFailure) return `meta_${error.category}_${error.code}`
  if (
    error instanceof Error &&
    [
      'post_missing',
      'version_changed',
      'preflight_failed',
      'identity_changed',
      'missing_container',
      'container_start_missing',
      'container_timeout',
      'container_rejected',
      'missing_provider_confirmation',
      'provider_confirmation_mismatch',
    ].includes(error.message)
  )
    return error.message
  return 'publication_check_failed'
}

type PublicationAttemptEvent =
  | 'started'
  | 'retry_scheduled'
  | 'deferred'
  | 'published'
  | 'failed'
  | 'uncertain'

export function publicationRequestHash(
  job: Pick<
    Job,
    | 'id'
    | 'post_id'
    | 'business_id'
    | 'post_version'
    | 'content_version'
    | 'target_page_id'
    | 'target_instagram_id'
  >,
) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        job.id,
        job.post_id,
        job.business_id,
        job.post_version,
        job.content_version,
        job.target_page_id,
        job.target_instagram_id,
      ]),
    )
    .digest('hex')
}

export function publicationLogicalKey(
  businessId: string,
  postId: string,
  requestedVersion: number,
) {
  return createHash('sha256')
    .update(JSON.stringify(['publication', businessId, postId, requestedVersion]))
    .digest('hex')
}

async function recordPublicationAttempt(
  db: Pool | PoolClient,
  job: Job,
  eventType: PublicationAttemptEvent,
  failureCode: string | null = null,
  providerPostId: string | null = null,
) {
  await db.query(
    `INSERT INTO publication_attempts
       (job_id,business_id,post_id,attempt_number,event_type,request_hash,failure_code,provider_post_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (job_id,attempt_number,event_type) DO NOTHING`,
    [
      job.id,
      job.business_id,
      job.post_id,
      Math.max(job.attempt_count, 1),
      eventType,
      publicationRequestHash(job),
      failureCode,
      providerPostId,
    ],
  )
}

export function publicationFailureDisposition(status: string, code: string | null) {
  if (status === 'pending' && code) return 'retryable' as const
  if (code?.startsWith('meta_authentication_') || code?.startsWith('meta_permission_'))
    return 'blocked' as const
  if (status === 'uncertain') return 'uncertain' as const
  return 'terminal' as const
}

export function publicationRemediation(code: string | null) {
  if (code?.startsWith('meta_authentication_'))
    return 'Rilidhe llogarinë Meta; token-i aktual nuk është më i vlefshëm.'
  if (code?.startsWith('meta_permission_'))
    return 'Rilidhe llogarinë Meta dhe mirato lejet e kërkuara për publikim.'
  if (code?.startsWith('meta_media_') || code === 'container_rejected')
    return 'Kontrollo formatin dhe madhësinë e fotografisë, pastaj valido postimin sërish.'
  if (
    code?.startsWith('meta_rate_limit_') ||
    code?.startsWith('meta_server_') ||
    code?.startsWith('meta_network_')
  )
    return 'Meta është përkohësisht e zënë; sistemi do të provojë sërish automatikisht.'
  if (code?.startsWith('retry_exhausted_'))
    return 'Tentimet automatike përfunduan. Kontrollo lidhjen dhe nise publikimin sërish.'
  if (code === 'version_changed')
    return 'Postimi ndryshoi pas planifikimit. Kontrollo dhe mirato versionin aktual.'
  if (code === 'preflight_failed' || code === 'publication_check_failed')
    return 'Kontrollo lidhjen, përmbajtjen dhe fotografinë, pastaj valido postimin sërish.'
  return 'Kontrollo gjendjen e lidhjes dhe postimin përpara një tentimi të ri.'
}

async function schedulePublicationRetry(job: Job, error: MetaFailure) {
  const delay = publicationRetryDelaySeconds(
    job.id,
    job.retry_count,
    error.retryAfterSeconds,
  )
  const client = await database().connect()
  try {
    await client.query('BEGIN')
    const code = publicationFailureCode(error)
    const result = await client.query(
      `UPDATE publication_jobs
         SET status='pending', run_at=now()+($2 * interval '1 second'),
             retry_count=retry_count+1, locked_at=null, last_attempt_at=now(),
             failure_code=$3, updated_at=now()
       WHERE id=$1 AND status='processing' AND retry_count+1<max_attempts
       RETURNING id`,
      [job.id, delay, code],
    )
    if (result.rowCount) await recordPublicationAttempt(client, job, 'retry_scheduled', code)
    await client.query('COMMIT')
    return !!result.rowCount
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function deferPublicationJob(job: Job) {
  const client = await database().connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      "UPDATE publication_jobs SET status='pending',run_at=now()+interval '1 minute',locked_at=null,updated_at=now() WHERE id=$1 AND status='processing' RETURNING id",
      [job.id],
    )
    if (result.rowCount) await recordPublicationAttempt(client, job, 'deferred')
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
async function finishJob(
  job: Job,
  state: 'published' | 'failed' | 'uncertain',
  code: string | null,
  providerId?: string,
  db: Pool | PoolClient = database(),
) {
  const ownsTransaction = 'connect' in db
  const client = (ownsTransaction ? await db.connect() : db) as PoolClient
  try {
    if (ownsTransaction) await client.query('BEGIN')
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [job.business_id])
    const updated = await client.query(
      "UPDATE publication_jobs SET status=$1,failure_code=$2,provider_post_id=COALESCE($3,provider_post_id),locked_at=null,last_attempt_at=now(),updated_at=now() WHERE id=$4 AND status IN ('processing','uncertain') RETURNING id",
      [state, code, providerId || null, job.id],
    )
    if (!updated.rowCount) {
      if (ownsTransaction) await client.query('COMMIT')
      return
    }
    await recordPublicationAttempt(client, job, state, code, providerId || null)
    const row = await client.query(
      'SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE',
      [job.post_id, job.business_id],
    )
    if (row.rows[0]?.payload.version === job.post_version) {
      const post = postSchema.parse(row.rows[0].payload)
      post.status = state === 'published' ? 'published' : 'failed'
      post.policyReason =
        state === 'published'
          ? 'Meta e konfirmoi publikimin.'
          : state === 'uncertain'
            ? 'Meta nuk dha konfirmim të plotë. Kontrollo profilin përpara çdo riprovimi; postimi nuk ridërgohet automatikisht.'
            : publicationRemediation(code)
      if (state === 'published') {
        post.providerPostId = providerId
        post.publishedAt = new Date().toISOString()
      }
      await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2', [
        JSON.stringify(post),
        post.id,
      ])
      await client.query('UPDATE businesses SET revision=revision+1 WHERE id=$1', [job.business_id])
      await client.query(
        'INSERT INTO audit_events (business_id,actor_id,action,revision) SELECT id,owner_id,$2,revision FROM businesses WHERE id=$1',
        [job.business_id, `publication.${state}`],
      )
    }
    if (ownsTransaction) await client.query('COMMIT')
  } catch (error) {
    if (ownsTransaction) await client.query('ROLLBACK')
    throw error
  } finally {
    if (ownsTransaction) client.release()
  }
}

export async function reconcileUncertainPublication(
  postId: string,
  businessId: string,
  db: Pool | PoolClient = database(),
) {
  const result = await db.query(
    "SELECT j.*,p.payload FROM publication_jobs j JOIN posts p ON p.id=j.post_id AND p.business_id=j.business_id WHERE j.post_id=$1 AND j.business_id=$2 AND j.status='uncertain' ORDER BY j.created_at DESC LIMIT 1",
    [postId, businessId],
  )
  const job = result.rows[0] as (Job & { payload: unknown }) | undefined
  if (!job)
    throw createError({ statusCode: 409, message: 'Nuk ka publikim që pret verifikim.' })
  const post = postSchema.parse(job.payload)
  const connection = await connectedMeta(businessId, db)
  if (
    connection.page_id !== job.target_page_id ||
    (post.channel === 'Instagram' && connection.instagram_id !== job.target_instagram_id)
  )
    throw createError({
      statusCode: 409,
      message: 'Rilidhe të njëjtën faqe ku u nis publikimi përpara kontrollit.',
    })
  const token = decryptMetaToken(connection.page_token_ciphertext, businessId)
  let providerId = job.provider_post_id
  if (providerId) {
    const verified = await graphRequest<{ id: string }>(providerId, token, { fields: 'id' })
    if (verified.id !== providerId) providerId = null
  } else {
    const path =
      post.channel === 'Instagram'
        ? `${connection.instagram_id}/media`
        : `${connection.page_id}/published_posts`
    const fields =
      post.channel === 'Instagram' ? 'id,caption,timestamp' : 'id,message,created_time'
    const candidates = await graphRequest<{ data: ProviderPublication[] }>(path, token, {
      fields,
      limit: '50',
      since: String(Math.floor((job.run_at.getTime() - 5 * 60 * 1000) / 1000)),
    })
    providerId = uniquePublicationMatch(candidates.data || [], post, job.run_at)?.id || null
  }
  if (!providerId) {
    await db.query(
      "UPDATE publication_jobs SET failure_code='reconciliation_no_unique_match',updated_at=now() WHERE id=$1 AND status='uncertain'",
      [job.id],
    )
    return { resolved: false as const }
  }
  await finishJob(job, 'published', null, providerId, db)
  return { resolved: true as const, providerPostId: providerId }
}
// Claims use SKIP LOCKED; network calls never hold a database transaction open.
async function runOnePublishingJob() {
  if (process.env.PUBLISHING_ENABLED !== 'true' || !metaConfigured()) return { processed: 0 }
  await database().query(
    "INSERT INTO worker_heartbeats (name) VALUES ('publisher') ON CONFLICT(name) DO UPDATE SET last_seen_at=now()",
  )
  // A crashed process may have sent a POST. It must never be retried blindly.
  const stale = await database().query(
    "SELECT * FROM publication_jobs WHERE status='processing' AND locked_at<now()-interval '10 minutes' LIMIT 10",
  )
  for (const job of stale.rows) await finishJob(job, 'uncertain', 'worker_interrupted')
  const claimClient = await database().connect()
  let job: Job | undefined
  try {
    await claimClient.query('BEGIN')
    const business = await claimClient.query(
      "SELECT id FROM businesses WHERE EXISTS (SELECT 1 FROM publication_jobs WHERE business_id=businesses.id AND status='pending' AND run_at<=now()) ORDER BY (SELECT min(run_at) FROM publication_jobs WHERE business_id=businesses.id AND status='pending' AND run_at<=now()),id FOR UPDATE SKIP LOCKED LIMIT 1",
    )
    if (business.rows[0]) {
      const claimed = await claimClient.query(
        "UPDATE publication_jobs SET status='processing',attempt_count=attempt_count+1,locked_at=now(),last_attempt_at=now(),updated_at=now() WHERE id IN (SELECT id FROM publication_jobs WHERE business_id=$1 AND status='pending' AND run_at<=now() ORDER BY run_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",
        [business.rows[0].id],
      )
      job = claimed.rows[0]
      if (job) await recordPublicationAttempt(claimClient, job, 'started')
    }
    await claimClient.query('COMMIT')
  } catch (error) {
    await claimClient.query('ROLLBACK')
    throw error
  } finally {
    claimClient.release()
  }
  if (!job) return { processed: 0 }
  let publicWriteStarted = false
  let publicWriteAccepted = false
  try {
    await requireEntitlement(job.business_id, 'publishing')
    const row = await database().query('SELECT payload FROM posts WHERE id=$1 AND business_id=$2', [
      job.post_id,
      job.business_id,
    ])
    if (!row.rows[0]) throw new Error('post_missing')
    const post = postSchema.parse(row.rows[0].payload)
    if (
      post.version !== job.post_version ||
      postContentVersion(post) !== job.content_version ||
      post.status !== 'scheduled' ||
      post.publicationMode !== 'automatic'
    )
      throw new Error('version_changed')
    const checks = [
      ...(await localPostChecks(post, job.business_id)),
      ...(await providerPostChecks(post, job.business_id, { throwProviderFailure: true })),
    ]
    if (checks.some((check) => !check.passed)) throw new Error('preflight_failed')
    const connection = await connectedMeta(job.business_id)
    if (
      connection.page_id !== job.target_page_id ||
      (post.channel === 'Instagram' && connection.instagram_id !== job.target_instagram_id)
    )
      throw new Error('identity_changed')
    const token = decryptMetaToken(connection.page_token_ciphertext, job.business_id)
    let providerId: string | undefined
    if (post.channel === 'Facebook') {
      publicWriteStarted = true
      const response = await graphRequest<{ id?: string; post_id?: string }>(
        `${connection.page_id}/photos`,
        token,
        { url: publicMediaUrl(post.image), caption: post.caption, published: 'true' },
        'POST',
      )
      providerId = response.post_id || response.id
    } else {
      let container = job.provider_container_id
      if (!container) {
        // Container creation does not publish content and is safe to fail without duplicating a post.
        const response = await graphRequest<{ id?: string }>(
          `${connection.instagram_id}/media`,
          token,
          { image_url: publicMediaUrl(post.image), caption: post.caption },
          'POST',
        )
        if (!response.id) throw new Error('missing_container')
        container = response.id
        const stored = await database().query(
          'UPDATE publication_jobs SET provider_container_id=$1,container_started_at=COALESCE(container_started_at,now()),updated_at=now() WHERE id=$2 RETURNING container_started_at',
          [container, job.id],
        )
        job.container_started_at = stored.rows[0].container_started_at
      }
      const status = await graphRequest<{ status_code: string }>(container, token, {
        fields: 'status_code',
      })
      if (status.status_code === 'IN_PROGRESS') {
        const startedAt = job.container_started_at
        if (!startedAt) throw new Error('container_start_missing')
        if (instagramContainerTimedOut(startedAt)) throw new Error('container_timeout')
        await deferPublicationJob(job)
        return { processed: 1 }
      }
      if (status.status_code !== 'FINISHED') throw new Error('container_rejected')
      publicWriteStarted = true
      const response = await graphRequest<{ id?: string }>(
        `${connection.instagram_id}/media_publish`,
        token,
        { creation_id: container },
        'POST',
      )
      providerId = response.id
    }
    if (!providerId) throw new Error('missing_provider_confirmation')
    publicWriteAccepted = true
    // Persist the receipt before reading it back; operators can reconcile an interrupted read.
    await database().query('UPDATE publication_jobs SET provider_post_id=$1 WHERE id=$2', [
      providerId,
      job.id,
    ])
    const verified = await graphRequest<{ id: string }>(providerId, token, { fields: 'id' })
    if (verified.id !== providerId) throw new Error('provider_confirmation_mismatch')
    await finishJob(job, 'published', null, providerId)
  } catch (error) {
    if (error instanceof MetaFailure && error.safeToRetry) {
      if (await schedulePublicationRetry(job, error)) return { processed: 1 }
      await finishJob(job, 'failed', `retry_exhausted_${error.category}`)
      return { processed: 1 }
    }
    const definiteRejection =
      !publicWriteAccepted && error instanceof MetaFailure && !error.retryable && error.code !== 0
    await finishJob(
      job,
      publicWriteStarted && !definiteRejection ? 'uncertain' : 'failed',
      publicationFailureCode(error),
    )
  }
  return { processed: 1 }
}

export function publishingBatchSize(value = process.env.PUBLISHING_BATCH_SIZE) {
  const parsed = Number(value || 5)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 25 ? parsed : 5
}

export async function runPublishingBatch() {
  let processed = 0
  for (let index = 0; index < publishingBatchSize(); index++) {
    const result = await runOnePublishingJob()
    processed += result.processed
    if (!result.processed) break
  }
  return { processed }
}
