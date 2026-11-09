import type { Pool, PoolClient } from 'pg'
import type { TikTokPostSettings } from './tiktok'

/** The account holder's TikTok choices for one post, or null when none were made. */
export async function tiktokPostSettings(
  postId: string,
  businessId: string,
  db: Pool | PoolClient,
): Promise<TikTokPostSettings | null> {
  const result = await db.query<{
    privacy_level: string
    disable_comment: boolean
    disable_duet: boolean
    disable_stitch: boolean
    brand_organic: boolean
    branded_content: boolean
  }>(
    'SELECT privacy_level,disable_comment,disable_duet,disable_stitch,brand_organic,branded_content FROM post_tiktok_settings WHERE post_id=$1 AND business_id=$2',
    [postId, businessId],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    privacyLevel: row.privacy_level,
    disableComment: row.disable_comment,
    disableDuet: row.disable_duet,
    disableStitch: row.disable_stitch,
    brandOrganic: row.brand_organic,
    brandedContent: row.branded_content,
  }
}
