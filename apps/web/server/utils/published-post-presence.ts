import { postSchema } from '../../shared/schemas/workspace'
import { recordAuditEvent, transitionMetadata } from './audit'
import { instagramTarget } from './instagram'
import { connectedMeta, decryptMetaToken, graphRequest, MetaFailure, type GraphHost } from './meta'

// Meta answers a read of a deleted post with "object does not exist".
const removedCode = 100
// Posts published longer ago than this are no longer checked on each visit.
const recentDays = 90
const batchLimit = 20

/** The published Facebook and Instagram posts of the user's business recent enough to check. */
export async function recentPublishedPostIds(userId: string) {
  return withBusinessTransaction(userId, async (client, business) => {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM posts
        WHERE business_id=$1
          AND payload->>'status'='published'
          AND payload->>'providerPostId' IS NOT NULL
          AND payload->>'channel' IN ('Facebook','Instagram')
          AND (payload->>'publishedAt')::timestamptz > now() - make_interval(days => $2)
        ORDER BY payload->>'publishedAt' DESC
        LIMIT $3`,
      [business.id, recentDays, batchLimit],
    )
    return result.rows.map((row) => row.id)
  })
}

// Whether Meta confirms the post no longer exists. Instagram answers a read
// of a deleted media with "does not exist". Facebook answers a deleted Page
// post with a permission error it also gives for other reasons, so a Page
// post counts as deleted only when the Page's own published posts, read
// successfully, no longer contain it.
async function removedFromNetwork(snapshot: {
  providerPostId: string
  publishedAt?: string
  target: { token: string; host: GraphHost; pageId: string | null }
}) {
  const { providerPostId, target } = snapshot
  try {
    await graphRequest<{ id: string }>(providerPostId, target.token, { fields: 'id' }, 'GET', target.host)
    return false
  } catch (error) {
    if (!(error instanceof MetaFailure)) return false
    if (!target.pageId) return error.code === removedCode
  }
  const since = snapshot.publishedAt ? Math.floor(Date.parse(snapshot.publishedAt) / 1000) - 3600 : undefined
  try {
    const posts = await graphRequest<{ data: { id: string }[] }>(`${target.pageId}/published_posts`, target.token, {
      fields: 'id',
      limit: '100',
      ...(since ? { since: String(since) } : {}),
    })
    return Array.isArray(posts.data) && !posts.data.some((post) => post.id === providerPostId)
  } catch {
    return false
  }
}

// A published post deleted on Facebook or Instagram returns to approved, so it
// can be published again; Meta sends no notice of the deletion itself.
export async function checkPublishedPost(userId: string, postId: string) {
  const snapshot = await withBusinessTransaction(userId, async (client, business) => {
    const row = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2', [
      postId,
      business.id,
    ])
    if (!row.rows[0]) throw createError({ statusCode: 404, message: 'server.POST_NOT_FOUND' })
    const post = postSchema.parse(row.rows[0].payload)
    if (post.status !== 'published' || !post.providerPostId || post.channel === 'TikTok') return null
    let target: { token: string; host: GraphHost; pageId: string | null } | null = null
    if (post.channel === 'Instagram') {
      const instagram = await instagramTarget(business.id, client)
      if (instagram) target = { token: instagram.token, host: instagram.host, pageId: null }
    } else {
      const page = await connectedMeta(business.id, client).catch(() => null)
      if (page)
        target = { token: decryptMetaToken(page.page_token_ciphertext, business.id), host: 'facebook', pageId: page.page_id }
    }
    return target
      ? { businessId: business.id, providerPostId: post.providerPostId, publishedAt: post.publishedAt, target }
      : null
  })
  if (!snapshot) return false
  if (!(await removedFromNetwork(snapshot))) return false
  return withBusinessTransaction(userId, async (client, business) => {
    if (business.id !== snapshot.businessId) return false
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [business.id])
    const row = await client.query<{ payload: unknown }>('SELECT payload FROM posts WHERE id=$1 AND business_id=$2 FOR UPDATE', [
      postId,
      business.id,
    ])
    if (!row.rows[0]) return false
    const post = postSchema.parse(row.rows[0].payload)
    if (post.status !== 'published' || post.providerPostId !== snapshot.providerPostId) return false
    post.status = 'approved'
    post.scheduledAt = null
    post.publicationMode = undefined
    post.providerPostId = undefined
    post.publishedAt = undefined
    post.policyReason = 'server.POST_REMOVED_FROM_NETWORK'
    post.version++
    await client.query('UPDATE posts SET payload=$1,updated_at=now() WHERE id=$2', [JSON.stringify(post), post.id])
    const revision = await client.query<{ revision: number }>(
      'UPDATE businesses SET revision=revision+1 WHERE id=$1 RETURNING revision',
      [business.id],
    )
    await recordAuditEvent(client, {
      actorId: userId,
      organizationId: business.id,
      resourceType: 'post',
      resourceId: post.id,
      action: 'publication.removed_from_network',
      metadata: { ...transitionMetadata({ status: ['published', 'approved'] }), providerPostId: snapshot.providerPostId },
      revision: revision.rows[0]?.revision || 0,
    })
    return true
  })
}
