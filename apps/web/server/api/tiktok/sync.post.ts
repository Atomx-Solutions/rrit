import { z } from 'zod'
import { connectedTikTok, listTikTokVideos } from '../../utils/tiktok'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const { business, connection } = await withBusinessTransaction(user.id, async (client, business) => {
    await requireEntitlement(business.id, 'social_import', client)
    const row = await connectedTikTok(business.id, client)
    if (!row) throw createError({ statusCode: 409, message: 'server.TIKTOK_NOT_CONNECTED' })
    if (!row.scopes.includes('video.list') && !row.scopes.includes('video.upload'))
      throw createError({ statusCode: 409, message: 'server.TIKTOK_SCOPE_MISSING' })
    return { business, connection: row }
  })
  const input = z
    .object({ cursor: z.coerce.number().int().min(0).optional() })
    .safeParse(await boundedBody(event, 1024))
  if (!input.success) throw createError({ statusCode: 422, message: 'server.INVALID_INPUT' })

  const accessToken = connection.token
  let response
  try {
    response = await listTikTokVideos(accessToken, input.data.cursor)
  } catch (err) {
    console.error('[tiktok-sync] listTikTokVideos failed:', err)
    throw createError({ statusCode: 502, message: 'server.TIKTOK_LIST_FAILED' })
  }

  const client = await database().connect()
  try {
    await client.query('BEGIN')
    await setTenantContext(client, { userId: user.id, organizationId: business.id })
    const current = await client.query(
      "SELECT id FROM tiktok_connections WHERE id=$1 AND business_id=$2 AND status='connected' FOR UPDATE",
      [connection.id, business.id],
    )
    if (!current.rows.length)
      throw createError({ statusCode: 409, message: 'server.ACCOUNT_CHANGED_DURING_IMPORT' })
    await requireEntitlement(business.id, 'social_import', client)
    for (const video of response.videos) {
      if (!video.id || !video.create_time) continue
      const publishedAt = new Date(video.create_time * 1000).toISOString()
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
          null,
          'TikTok',
          connection.open_id,
          video.id,
          video.title || '',
          safeUrl(video.cover_image_url),
          safeUrl(video.share_url),
          publishedAt,
          'VIDEO',
        ],
      )
    }
    await client.query(
      'UPDATE tiktok_connections SET updated_at=now() WHERE id=$1',
      [connection.id],
    )
    await client.query('COMMIT')
    return {
      imported: response.videos.length,
      nextCursor: response.hasMore ? response.cursor ?? null : null,
    }
  } catch (error) {
    console.error('[tiktok-sync] DB error:', error)
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
})
