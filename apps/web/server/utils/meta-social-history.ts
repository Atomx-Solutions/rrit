import type { Pool, PoolClient } from 'pg'
import { instagramTarget, markInstagramTargetSynced } from './instagram'
import { connectedMeta, decryptMetaToken, graphRequest, type GraphHost, type MetaList } from './meta'

type SocialChannel = 'Facebook' | 'Instagram'

type RemoteSocialPost = {
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

const pageSize = '100'
const maxPages = 200
const fullSyncIntervalMs = 10 * 60 * 1000
const lastFullSyncAt = new Map<string, number>()

function safeUrl(value?: string) {
  try {
    const url = new URL(value || '')
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

async function syncChannel(
  db: Pool | PoolClient,
  businessId: string,
  channel: SocialChannel,
  sourceAccountId: string,
  brandId: string | null,
  token: string,
  host: GraphHost,
  latestPosts?: number,
) {
  const instagram = channel === 'Instagram'

  let after: string | undefined

  // With latestPosts, Meta returns the newest posts first, so one bounded page
  // is the complete result; the full-history walk is skipped entirely.
  const pages = latestPosts ? 1 : maxPages
  for (let page = 0; page < pages; page += 1) {
    const response = await graphRequest<MetaList<RemoteSocialPost>>(
      `${sourceAccountId}/${instagram ? 'media' : 'posts'}`,
      token,
      {
        fields: instagram
          ? 'id,caption,media_type,media_url,permalink,timestamp'
          : 'id,message,full_picture,permalink_url,created_time',
        limit: latestPosts ? String(Math.min(latestPosts, 100)) : pageSize,
        ...(after ? { after } : {}),
      },
      'GET',
      host,
    )
    if (!Array.isArray(response.data)) throw new Error('Meta returned an invalid post list.')

    for (const post of response.data) {
      const timestamp = post.timestamp || post.created_time
      if (!post.id || !timestamp || !Number.isFinite(Date.parse(timestamp))) continue
      await db.query(
        `INSERT INTO social_posts
          (business_id,brand_id,channel,source_account_id,provider_id,caption,media_url,permalink,published_at,media_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (business_id,channel,source_account_id,provider_id) DO UPDATE SET
           caption=EXCLUDED.caption,
           media_url=EXCLUDED.media_url,
           permalink=EXCLUDED.permalink,
           published_at=EXCLUDED.published_at,
           media_type=EXCLUDED.media_type,
           imported_at=now()`,
        [
          businessId,
          brandId,
          channel,
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

    const next = response.paging?.cursors?.after
    if (!response.paging?.next || !next || next === after) {
      break
    }
    after = next
  }

  // Never delete historical social posts during a provider sync. Meta can
  // legitimately omit older, visitor-created, permission-limited or expired
  // media from a later response. The connected page is reconciled explicitly
  // when the account changes; retention handles bounded storage separately.
}

// Facebook posts come from the connected page; Instagram posts from the
// account connected through Instagram Login, otherwise the page's account.
async function syncConnectedChannels(db: Pool | PoolClient, businessId: string, latestPosts?: number) {
  let page: Awaited<ReturnType<typeof connectedMeta>> | null = null
  let missing: unknown
  try {
    page = await connectedMeta(businessId, db)
  } catch (error) {
    missing = error
  }
  const instagram = await instagramTarget(businessId, db)
  if (!page && !instagram) throw missing
  if (page) {
    await syncChannel(
      db,
      businessId,
      'Facebook',
      page.page_id,
      page.brand_id,
      decryptMetaToken(page.page_token_ciphertext, businessId),
      'facebook',
      latestPosts,
    )
    await db.query('UPDATE meta_connections SET last_sync_at=now(),updated_at=now() WHERE id=$1', [page.id])
  }
  if (instagram) {
    await syncChannel(
      db,
      businessId,
      'Instagram',
      instagram.id,
      instagram.brandId,
      instagram.token,
      instagram.host,
      latestPosts,
    )
    await markInstagramTargetSynced(instagram, db)
  }
}

/** Fetches only the newest posts of each connected channel (the monthly style fetch). */
export async function fetchLatestSocialPosts(
  db: Pool | PoolClient,
  businessId: string,
  latestPosts: number,
) {
  await syncConnectedChannels(db, businessId, latestPosts)
}

/** Refresh every post currently available from the connected accounts. */
export async function syncAllConnectedSocialPosts(
  db: Pool | PoolClient,
  businessId: string,
) {
  const previous = lastFullSyncAt.get(businessId) || 0
  if (Date.now() - previous < fullSyncIntervalMs) return
  await syncConnectedChannels(db, businessId)
  lastFullSyncAt.set(businessId, Date.now())
}
