import { z } from 'zod'
import type { MetaList } from '../../utils/meta'
type RemotePost = {
  id: string
  message?: string
  caption?: string
  full_picture?: string
  media_url?: string
  permalink_url?: string
  permalink?: string
  created_time?: string
  timestamp?: string
  media_type?: string
}
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const { business, connection } = await withBusinessTransaction(user.id, async (client, business) => {
    await requireEntitlement(business.id, 'social_import', client)
    return { business, connection: await connectedMeta(business.id, client) }
  })
  const input = z
    .object({ channel: z.enum(['Facebook', 'Instagram']), after: z.string().max(2000).optional() })
    .safeParse(await boundedBody(event, 4096))
  if (!input.success) throw createError({ statusCode: 422, message: 'Zgjidh rrjetin social.' })
  const instagram = input.data.channel === 'Instagram'
  if (instagram && !connection.instagram_id)
    throw createError({
      statusCode: 409,
      message: 'Lidh profilin profesional të Instagram-it me faqen e Facebook-ut.',
    })
  const sourceAccountId = instagram ? connection.instagram_id! : connection.page_id
  let response: MetaList<RemotePost>
  try {
    response = await graphRequest<MetaList<RemotePost>>(
      `${instagram ? connection.instagram_id : connection.page_id}/${instagram ? 'media' : 'posts'}`,
      decryptMetaToken(connection.page_token_ciphertext, business.id),
      {
        fields: instagram
          ? 'id,caption,media_type,media_url,permalink,timestamp'
          : 'id,message,full_picture,permalink_url,created_time',
        limit: '25',
        ...(input.data.after ? { after: input.data.after } : {}),
      },
    )
  } catch (error) {
    if (error instanceof MetaFailure && error.code === 190)
      await withBusinessTransaction(user.id, (client) =>
        client.query(
          "UPDATE meta_connections SET status='expired',updated_at=now() WHERE id=$1",
          [connection.id],
        ),
      )
    throw createError({
      statusCode: 502,
      message: 'Postimet nuk u lexuan nga Meta. Kontrollo lidhjen dhe lejet, pastaj provo sërish.',
    })
  }
  if (!Array.isArray(response.data))
    throw createError({ statusCode: 502, message: 'Meta ktheu një përgjigje të paplotë.' })
  const client = await database().connect()
  try {
    await client.query('BEGIN')
    await setTenantContext(client, { userId: user.id, organizationId: business.id })
    const current = await client.query(
      "SELECT id FROM meta_connections WHERE id=$1 AND business_id=$2 AND status='connected' AND page_id=$3 FOR UPDATE",
      [connection.id, business.id, connection.page_id],
    )
    if (!current.rows.length)
      throw createError({
        statusCode: 409,
        message: 'Llogaria ndryshoi gjatë importimit. Provo sërish.',
      })
    await requireEntitlement(business.id, 'social_import', client)
    const remoteProviderIds: string[] = []
    for (const post of response.data) {
      const timestamp = post.timestamp || post.created_time
      if (!post.id || !timestamp || !Number.isFinite(Date.parse(timestamp))) continue
      remoteProviderIds.push(post.id)
      const safeUrl = (value?: string) => {
        try {
          const url = new URL(value || '')
          return url.protocol === 'https:' ? url.href : null
        } catch {
          return null
        }
      }
      await client.query(
        'INSERT INTO social_posts (business_id,channel,source_account_id,provider_id,caption,media_url,permalink,published_at,media_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (business_id,channel,source_account_id,provider_id) DO UPDATE SET caption=EXCLUDED.caption,media_url=EXCLUDED.media_url,permalink=EXCLUDED.permalink,published_at=EXCLUDED.published_at,media_type=EXCLUDED.media_type,imported_at=now()',
        [
          business.id,
          input.data.channel,
          sourceAccountId,
          post.id,
          post.caption || post.message || '',
          safeUrl(post.media_url || post.full_picture),
          safeUrl(post.permalink || post.permalink_url),
          timestamp,
          post.media_type || 'POST',
        ],
      )
    }
    // A refresh without a cursor is a reconciliation of the first page. Only
    // remove local rows when Meta confirms that this is the complete result;
    // otherwise older local posts may still exist on the next page.
    if (!input.data.after && !response.paging?.next) {
      await client.query(
        'DELETE FROM social_posts WHERE business_id=$1 AND channel=$2 AND source_account_id=$3 AND NOT (provider_id = ANY($4::text[]))',
        [business.id, input.data.channel, sourceAccountId, remoteProviderIds],
      )
    }
    await client.query(
      'UPDATE meta_connections SET last_sync_at=now(),updated_at=now() WHERE id=$1',
      [connection.id],
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
