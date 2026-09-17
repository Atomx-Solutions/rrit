import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { createError } from 'h3'
import {
  paginatedResponseSchema,
  type PostCreate,
  type PostUpdate,
  type WorkspacePostListQuery,
} from '../../shared/schemas/workspace-resources'
import { postSchema, validateTransition, type Post } from '../../shared/schemas/workspace'
import { recordAuditEvent, transitionMetadata } from './audit'
import {
  blockingPostChecks,
  postContentSnapshot,
  postContentVersion,
  postFingerprint,
  requireCurrentApproval,
  requireFreshValidation,
  localPostChecks,
} from './post-validation'
import { requireEntitlement, requireQuota } from './trials'
import { requirePublishingWorker, queuePublication } from './publishing'

const editableKeys = ['title', 'caption', 'channel', 'format', 'image', 'pillar'] as const
function fail(message: string): never {
  throw createError({ statusCode: 422, message })
}

function conflict(message: string): never {
  throw createError({ statusCode: 409, message })
}

function notFound(): never {
  throw createError({ statusCode: 404, message: 'Biznesi ose postimi nuk u gjet.' })
}

export async function listWorkspacePosts(
  db: Pool | PoolClient,
  businessId: string,
  input: WorkspacePostListQuery,
) {
  const values = [
    businessId,
    input.status ?? null,
    input.channel ?? null,
    input.from ?? null,
    input.to ?? null,
  ]
  const where = `p.business_id=$1
    AND ($2::text IS NULL OR p.payload->>'status'=$2)
    AND ($3::text IS NULL OR p.payload->>'channel'=$3)
    AND ($4::timestamptz IS NULL OR calendar_at >= $4::timestamptz)
    AND ($5::timestamptz IS NULL OR calendar_at <= $5::timestamptz)`
  // Old rows are treated as outside a calendar interval when their optional
  // date is malformed, instead of making the complete list request fail.
  const source = `posts p
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN COALESCE(p.payload->>'scheduledAt',p.payload->>'proposedAt')
          ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$'
        THEN COALESCE(p.payload->>'scheduledAt',p.payload->>'proposedAt')::timestamptz
        ELSE NULL
      END AS calendar_at
    ) calendar ON true`
  const count = await db.query(
    `SELECT count(*)::integer AS total FROM ${source} WHERE ${where}`,
    values,
  )
  const rows = await db.query(
    `SELECT p.payload FROM ${source} WHERE ${where}
     ORDER BY p.created_at DESC, p.id LIMIT $6 OFFSET $7`,
    [...values, input.pageSize, (input.page - 1) * input.pageSize],
  )
  const total = Number(count.rows[0]?.total || 0)
  return paginatedResponseSchema(postSchema).parse({
    items: rows.rows.map((row) => row.payload),
    page: input.page,
    pageSize: input.pageSize,
    total,
    hasNext: input.page * input.pageSize < total,
  })
}

async function lockWorkspaceRevision(
  client: PoolClient,
  businessId: string,
  userId: string,
  expectedRevision: number,
) {
  const locked = await client.query<{ revision: number }>(
    'SELECT revision FROM businesses WHERE id=$1 AND owner_id=$2 FOR UPDATE',
    [businessId, userId],
  )
  if (!locked.rows[0]) notFound()
  if (Number(locked.rows[0].revision) !== expectedRevision)
    conflict('Ka ndryshime nga një pajisje tjetër. Ngarko versionin e fundit.')
}

async function currentPost(client: PoolClient, businessId: string, postId: string) {
  const result = await client.query<{ payload: unknown }>(
    'SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE',
    [postId, businessId],
  )
  if (!result.rows[0]) notFound()
  return postSchema.parse(result.rows[0].payload)
}

async function postMutationContext(client: PoolClient, businessId: string, image: string) {
  const assetId = image.startsWith('/api/media/') ? image.slice('/api/media/'.length) : ''
  const [asset, inFlight] = await Promise.all([
    client.query('SELECT id FROM assets WHERE id=$1 AND business_id=$2 AND rights=true', [
      assetId,
      businessId,
    ]),
    client.query(
      "SELECT post_id FROM publication_jobs WHERE business_id=$1 AND status IN ('processing','uncertain')",
      [businessId],
    ),
  ])
  return {
    allowedImages: new Set<string>(asset.rows.length ? [image] : []),
    inFlightPostIds: inFlight.rows.map((job) => job.post_id as string),
  }
}

async function advanceWorkspaceRevision(
  client: PoolClient,
  businessId: string,
  userId: string,
  expectedRevision: number,
) {
  const saved = await client.query<{ revision: number }>(
    'UPDATE businesses SET revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2 AND revision=$3 RETURNING revision',
    [businessId, userId, expectedRevision],
  )
  if (!saved.rows[0]) conflict('Ka ndryshime nga një pajisje tjetër. Ngarko versionin e fundit.')
  return Number(saved.rows[0].revision)
}

export async function createWorkspacePost(
  client: PoolClient,
  { businessId, userId, input }: { businessId: string; userId: string; input: PostCreate },
) {
  await lockWorkspaceRevision(client, businessId, userId, input.workspaceRevision)
  const { workspaceRevision, ...content } = input
  const candidate: Post = {
    ...content,
    id: randomUUID(),
    status: 'draft',
    scheduledAt: null,
    publicationMode: 'manual',
    version: 1,
    contentVersion: 1,
    history: [],
    policy: 'warn',
    policyReason: 'Kontrollo faktet dhe fotografinë përpara miratimit.',
  }
  const context = await postMutationContext(client, businessId, candidate.image)
  await requireWorkspacePostQuota(client, businessId, [candidate], [])
  await requireWorkspacePostAccess(client, businessId, [candidate], [])
  const [post] = await saveWorkspacePosts(client, {
    businessId,
    userId,
    revision: workspaceRevision + 1,
    posts: [candidate],
    currentPosts: [],
    images: new Map(),
    ...context,
  })
  const revision = await advanceWorkspaceRevision(client, businessId, userId, workspaceRevision)
  await recordAuditEvent(client, {
    actorId: userId,
    organizationId: businessId,
    resourceType: 'post',
    resourceId: post!.id,
    action: 'post.created',
    revision,
  })
  return { post: post!, workspaceRevision: revision }
}

export async function updateWorkspacePost(
  client: PoolClient,
  {
    businessId,
    userId,
    postId,
    input,
  }: { businessId: string; userId: string; postId: string; input: PostUpdate },
) {
  await lockWorkspaceRevision(client, businessId, userId, input.workspaceRevision)
  const previous = await currentPost(client, businessId, postId)
  if (previous.version !== input.postVersion)
    conflict('Postimi ndryshoi nga një pajisje tjetër. Ngarko versionin e fundit.')
  const { workspaceRevision, postVersion: _postVersion, ...changes } = input
  const contentChanged = editableKeys.some(
    (key) => changes[key] !== undefined && changes[key] !== previous[key],
  )
  const candidate: Post = {
    ...previous,
    ...changes,
    status:
      contentChanged && changes.status === undefined ? 'draft' : changes.status || previous.status,
  }
  const context = await postMutationContext(client, businessId, candidate.image)
  await requireWorkspacePostAccess(client, businessId, [candidate], [previous])
  const [post] = await saveWorkspacePosts(client, {
    businessId,
    userId,
    revision: workspaceRevision + 1,
    posts: [candidate],
    currentPosts: [previous],
    images: new Map(),
    ...context,
  })
  const revision = await advanceWorkspaceRevision(client, businessId, userId, workspaceRevision)
  await recordAuditEvent(client, {
    actorId: userId,
    organizationId: businessId,
    resourceType: 'post',
    resourceId: post!.id,
    action: 'post.updated',
    revision,
    metadata: transitionMetadata({
      version: [previous.version, post!.version],
      content_version: [postContentVersion(previous), postContentVersion(post!)],
      status: [previous.status, post!.status],
    }),
  })
  return { post: post!, workspaceRevision: revision }
}

export async function requireWorkspacePostQuota(
  client: PoolClient,
  businessId: string,
  posts: Post[],
  currentPosts: Post[],
) {
  const newPostCount = posts.filter(
    (post) => !currentPosts.some((existing) => existing.id === post.id),
  ).length
  if (newPostCount) await requireQuota(businessId, 'posts_per_month', newPostCount, client)
}

export async function requireWorkspacePostAccess(
  client: PoolClient,
  businessId: string,
  posts: Post[],
  currentPosts: Post[],
) {
  if (
    posts.length !== currentPosts.length ||
    posts.some((p) => {
      const old = currentPosts.find((item) => item.id === p.id)
      return (
        !old ||
        editableKeys.some((key) => old[key] !== p[key]) ||
        old.status !== p.status ||
        old.scheduledAt !== p.scheduledAt
      )
    })
  )
    await requireEntitlement(businessId, 'posts', client)
}

// Caller owns the transaction, tenant context and workspace revision lock.
export async function saveWorkspacePosts(
  client: PoolClient,
  {
    businessId,
    userId,
    revision,
    posts,
    currentPosts,
    images,
    allowedImages,
    inFlightPostIds,
  }: {
    businessId: string
    userId: string
    revision: number
    posts: Post[]
    currentPosts: Post[]
    images: Map<string, string>
    allowedImages: Set<string>
    inFlightPostIds: string[]
  },
) {
  const savedPosts: Post[] = []
  for (const incoming of posts) {
    const previous = currentPosts.find((p) => p.id === incoming.id)
    const candidate = { ...incoming, image: images.get(incoming.image) || incoming.image }
    let contentChanged = !previous
    let approvalDecision: 'approved' | 'reopened' | null = null
    let removedFromCalendar = false
    let scheduledOnCalendar = false
    const postChanged =
      !previous ||
      editableKeys.some((key) => candidate[key] !== previous[key]) ||
      candidate.status !== previous.status ||
      candidate.scheduledAt !== previous.scheduledAt ||
      (candidate.publicationMode || 'manual') !== (previous.publicationMode || 'manual')
    if (postChanged && (!candidate.caption.trim() || !allowedImages.has(candidate.image)))
      fail('Plotëso tekstin dhe zgjidh një fotografi me të drejta të konfirmuara.')
    let post: Post
    if (!previous) {
      if (candidate.status !== 'draft') fail('Postimi i ri duhet të nisë si draft.')
      post = {
        ...candidate,
        status: 'draft',
        version: 1,
        contentVersion: 1,
        history: [],
        providerPostId: undefined,
        publishedAt: undefined,
        scheduledAt: null,
        proposedAt: undefined,
        aiProvenance: undefined,
        publicationMode: 'manual',
        policy: 'warn',
        policyReason: 'Kontrollo faktet dhe fotografinë përpara miratimit.',
      }
    } else {
      const changed = editableKeys.some((key) => candidate[key] !== previous[key])
      contentChanged = changed
      const statusChanged = candidate.status !== previous.status
      if (
        changed &&
        (!['draft', 'review'].includes(previous.status) || candidate.status !== 'draft')
      )
        fail('Rihap postimin si draft për ta redaktuar.')
      if (statusChanged && !changed) {
        if (inFlightPostIds.includes(previous.id))
          fail('Publikimi pret konfirmim nga Meta. Kontrollo gjendjen përpara ndryshimit.')
        const error = validateTransition(previous, candidate.status)
        if (error) fail(error)
        if (candidate.status === 'approved' && previous.status !== 'scheduled')
          await requireFreshValidation(previous, businessId, client)
        if (candidate.status === 'approved') approvalDecision = 'approved'
        removedFromCalendar = previous.status === 'scheduled' && candidate.status === 'approved'
        scheduledOnCalendar = previous.status !== 'scheduled' && candidate.status === 'scheduled'
        if (candidate.status === 'draft' && ['approved', 'failed'].includes(previous.status))
          approvalDecision = 'reopened'
        if (candidate.status === 'scheduled') {
          await requireCurrentApproval(previous, businessId, client)
          const checks = await localPostChecks(
            { ...previous, scheduledAt: candidate.scheduledAt },
            businessId,
            client,
          )
          const blockingChecks = blockingPostChecks(checks)
          if (blockingChecks.some((check) => !check.passed))
            fail(
              blockingChecks
                .filter((check) => !check.passed)
                .map((check) => check.message)
                .join(' '),
            )
          if (candidate.publicationMode === 'automatic') {
            await requireEntitlement(businessId, 'publishing', client)
            await requireFreshValidation(previous, businessId, client, 'publication')
            await requirePublishingWorker(client)
          }
        }
        if (previous.status === 'scheduled') {
          const processing = await client.query(
            "SELECT id FROM publication_jobs WHERE post_id=$1 AND status IN ('processing','uncertain') LIMIT 1",
            [previous.id],
          )
          if (processing.rows.length)
            fail('Publikimi ka filluar ose pret konfirmim. Kontrollo gjendjen përpara ndryshimit.')
          await client.query(
            "UPDATE publication_jobs SET status='cancelled',updated_at=now() WHERE post_id=$1 AND status='pending'",
            [previous.id],
          )
        }
      }
      if (!statusChanged && candidate.scheduledAt !== previous.scheduledAt)
        fail('Hiqe postimin nga kalendari përpara ndryshimit të orarit.')
      if (
        !statusChanged &&
        (candidate.publicationMode || 'manual') !== (previous.publicationMode || 'manual')
      )
        fail('Hiqe postimin nga kalendari përpara ndryshimit të mënyrës së publikimit.')
      if (
        candidate.status === 'scheduled' &&
        (statusChanged || candidate.scheduledAt !== previous.scheduledAt) &&
        (!candidate.scheduledAt ||
          !Number.isFinite(Date.parse(candidate.scheduledAt)) ||
          Date.parse(candidate.scheduledAt) <= Date.now())
      )
        fail('Zgjidh një orar të vlefshëm në të ardhmen.')
      post = { ...previous }
      if (changed) {
        for (const key of editableKeys) Object.assign(post, { [key]: candidate[key] })
        post.status = 'draft'
        post.scheduledAt = null
        post.publicationMode = 'manual'
        post.history = [
          ...previous.history,
          { version: previous.version, caption: previous.caption, at: new Date().toISOString() },
        ]
        post.contentVersion = postContentVersion(previous) + 1
        post.policy = 'warn'
        post.policyReason =
          'Përmbajtja ndryshoi. Kontrollo faktet dhe fotografinë përpara miratimit.'
      } else if (statusChanged) {
        post.status = candidate.status
        post.scheduledAt = candidate.status === 'scheduled' ? candidate.scheduledAt : null
        post.publicationMode =
          candidate.status === 'scheduled' ? candidate.publicationMode || 'manual' : 'manual'
      }
      post.version = previous.version + (changed || statusChanged ? 1 : 0)
    }
    if (!previous || editableKeys.some((key) => previous[key] !== post[key])) {
      const checks = await localPostChecks(post, businessId, client)
      post.policy = blockingPostChecks(checks).every((check) => check.passed) ? 'warn' : 'block'
      post.policyReason = checks.every((check) => check.passed)
        ? 'Kontrollet e përmbajtjes kaluan. Konfirmo faktet përpara miratimit. Meta është opsionale për kalendarin.'
        : checks
            .filter((check) => !check.passed)
            .map((check) => check.message)
            .join(' ')
    }
    // Provider-confirmed publication and policy results can never be supplied by this client.
    const saved = await client.query(
      'INSERT INTO posts (id, business_id, payload, content_version) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, content_version = EXCLUDED.content_version, updated_at = now() WHERE posts.business_id = EXCLUDED.business_id',
      [post.id, businessId, JSON.stringify(post), postContentVersion(post)],
    )
    if (!saved.rowCount) fail('Identifikuesi i postimit nuk është i disponueshëm.')
    if (contentChanged) {
      const recorded = await client.query(
        "INSERT INTO post_content_versions (post_id,business_id,content_version,fingerprint,snapshot,source,actor_id) VALUES ($1,$2,$3,$4,$5,'editor',$6) ON CONFLICT DO NOTHING RETURNING post_id",
        [
          post.id,
          businessId,
          postContentVersion(post),
          postFingerprint(post),
          JSON.stringify(postContentSnapshot(post)),
          userId,
        ],
      )
      if (!recorded.rowCount)
        fail('Versioni i përmbajtjes ekziston tashmë. Ngarko versionin e fundit.')
    }
    if (approvalDecision) {
      await client.query(
        "INSERT INTO post_approval_records (post_id,business_id,content_version,fingerprint,actor_id,decision,source) VALUES ($1,$2,$3,$4,$5,$6,'editor')",
        [
          post.id,
          businessId,
          postContentVersion(post),
          postFingerprint(post),
          userId,
          approvalDecision,
        ],
      )
      await recordAuditEvent(client, {
        actorId: userId,
        organizationId: businessId,
        resourceType: 'post',
        resourceId: post.id,
        action: `approval.${approvalDecision}`,
        metadata: {
          ...transitionMetadata({ status: [previous!.status, post.status] }),
          contentVersion: postContentVersion(post),
        },
      })
    }
    if (removedFromCalendar) {
      await recordAuditEvent(client, {
        actorId: userId,
        organizationId: businessId,
        resourceType: 'post',
        resourceId: post.id,
        action: 'post.unscheduled',
        revision: revision,
        metadata: transitionMetadata({
          status: [previous!.status, post.status],
          scheduled_at: [previous!.scheduledAt, post.scheduledAt],
        }),
      })
    }
    if (scheduledOnCalendar) {
      await recordAuditEvent(client, {
        actorId: userId,
        organizationId: businessId,
        resourceType: 'post',
        resourceId: post.id,
        action: 'post.scheduled',
        revision: revision,
        metadata: transitionMetadata({
          status: [previous!.status, post.status],
          scheduled_at: [previous!.scheduledAt, post.scheduledAt],
        }),
      })
    }
    if (
      post.status === 'scheduled' &&
      post.publicationMode === 'automatic' &&
      previous?.status !== 'scheduled'
    )
      await queuePublication(client, post, businessId, post.scheduledAt!)
    savedPosts.push(post)
  }
  if (currentPosts.some((p) => !posts.some((incoming) => incoming.id === p.id)))
    fail('Heqja e postimeve nuk mbështetet nga ky veprim.')
  return savedPosts
}
