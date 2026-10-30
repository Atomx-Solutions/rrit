import { z } from 'zod'
import { instagramTarget, markInstagramTargetExpired, markInstagramTargetSynced } from '../../utils/instagram'
import type { MetaList } from '../../utils/meta'
type RemotePost = {
  id: string
  message?: string
  caption?: string
  full_picture?: string
  media_url?: string
  thumbnail_url?: string
  permalink_url?: string
  permalink?: string
  created_time?: string
  timestamp?: string
  media_type?: string
  attachments?: {
    data?: Array<{
      media_type?: string
      type?: string
      url?: string
      media?: { source?: string; image?: { src?: string } }
    }>
  }
}
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const input = z
    .object({ channel: z.enum(['Facebook', 'Instagram']), after: z.string().max(2000).optional() })
    .safeParse(await boundedBody(event, 4096))
  if (!input.success) throw createError({ statusCode: 422, message: 'server.NETWORK_REQUIRED' })
  const instagram = input.data.channel === 'Instagram'
  // Instagram reads from the account connected through Instagram Login when
  // there is one, otherwise from the account linked to the Facebook page.
  const { business, source } = await withBusinessTransaction(user.id, async (client, business) => {
    await requireEntitlement(business.id, 'social_import', client)
    if (instagram) {
      const target = await instagramTarget(business.id, client)
      if (!target)
        throw createError({
          statusCode: 409,
          message: 'server.INSTAGRAM_LINK_REQUIRED',
        })
      return { business, source: { target, page: null } }
    }
    return { business, source: { target: null, page: await connectedMeta(business.id, client) } }
  })
  const sourceAccountId = source.target ? source.target.id : source.page!.page_id
  const brandId = source.target ? source.target.brandId : source.page!.brand_id
  let response: MetaList<RemotePost>
  try {
    response = await graphRequest<MetaList<RemotePost>>(
      `${sourceAccountId}/${instagram ? 'media' : 'posts'}`,
      source.target ? source.target.token : decryptMetaToken(source.page!.page_token_ciphertext, business.id),
      {
        fields: instagram
          ? 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp'
          : 'id,message,full_picture,permalink_url,created_time,attachments{media_type,type,url,media}',
        limit: '25',
        ...(input.data.after ? { after: input.data.after } : {}),
      },
      'GET',
      source.target ? source.target.host : 'facebook',
    )
  } catch (error) {
    if (error instanceof MetaFailure && error.code === 190)
      await withBusinessTransaction(user.id, async (client) => {
        if (source.target) await markInstagramTargetExpired(source.target, client)
        else
          await client.query(
            "UPDATE meta_connections SET status='expired',updated_at=now() WHERE id=$1",
            [source.page!.id],
          )
      })
    throw createError({
      statusCode: 502,
      message: 'server.META_POSTS_UNREADABLE',
    })
  }
  if (!Array.isArray(response.data))
    throw createError({ statusCode: 502, message: 'server.META_INCOMPLETE_RESPONSE' })
  const client = await database().connect()
  try {
    await client.query('BEGIN')
    await setTenantContext(client, { userId: user.id, organizationId: business.id })
    const current = source.target?.source === 'instagram'
      ? await client.query(
          "SELECT id FROM instagram_connections WHERE id=$1 AND business_id=$2 AND status='connected' AND instagram_user_id=$3 FOR UPDATE",
          [source.target.connectionId, business.id, sourceAccountId],
        )
      : await client.query(
          "SELECT id FROM meta_connections WHERE id=$1 AND business_id=$2 AND status='connected' AND page_id=$3 FOR UPDATE",
          [source.target?.connectionId || source.page!.id, business.id, source.target?.pageId || source.page!.page_id],
        )
    if (!current.rows.length)
      throw createError({
        statusCode: 409,
        message: 'server.ACCOUNT_CHANGED_DURING_IMPORT',
      })
    await requireEntitlement(business.id, 'social_import', client)
    for (const post of response.data) {
      const timestamp = post.timestamp || post.created_time
      if (!post.id || !timestamp || !Number.isFinite(Date.parse(timestamp))) continue
      const safeUrl = (value?: string) => {
        try {
          const url = new URL(value || '')
          return url.protocol === 'https:' ? url.href : null
        } catch {
          return null
        }
      }
      await client.query(
        'INSERT INTO social_posts (business_id,brand_id,channel,source_account_id,provider_id,caption,media_url,permalink,published_at,media_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (business_id,channel,source_account_id,provider_id) DO UPDATE SET brand_id=EXCLUDED.brand_id,caption=EXCLUDED.caption,media_url=EXCLUDED.media_url,permalink=EXCLUDED.permalink,published_at=EXCLUDED.published_at,media_type=EXCLUDED.media_type,imported_at=now()',
        [
          business.id,
          brandId,
          input.data.channel,
          sourceAccountId,
          post.id,
          post.caption || post.message || '',
          // Always a picture the page can show: an attachment's `url` is the
          // post's page on Facebook and a video's `source` is the film, so a
          // video shows its thumbnail instead.
          safeUrl(
            post.thumbnail_url ||
              post.media_url ||
              post.attachments?.data?.[0]?.media?.image?.src ||
              post.full_picture,
          ),
          safeUrl(post.permalink || post.permalink_url),
          timestamp,
          post.media_type ||
            post.attachments?.data?.[0]?.media_type ||
            post.attachments?.data?.[0]?.type ||
            (post.attachments?.data?.[0]?.media?.source ? 'VIDEO' : null) ||
            'POST',
        ],
      )
    }
    // A refresh is additive/upsert-only. Meta may omit older, visitor-created,
    // permission-limited or expired media from a later response, so a missing
    // provider id must never erase the local style history.
    if (source.target) await markInstagramTargetSynced(source.target, client)
    else
      await client.query(
        'UPDATE meta_connections SET last_sync_at=now(),updated_at=now() WHERE id=$1',
        [source.page!.id],
      )
    await client.query('COMMIT')
    return {
      imported: response.data.length,
      nextCursor: response.paging?.next ? response.paging.cursors?.after || null : null,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
