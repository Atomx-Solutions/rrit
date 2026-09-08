export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const business = await businessForUser(user.id)
  const result = await database().query(
    'SELECT status,page_id,page_name,instagram_id,instagram_username,expires_at,last_sync_at,scopes FROM meta_connections WHERE business_id=$1',
    [business.id],
  )
  const row = result.rows[0] as
    | {
        status: string
        page_id: string | null
        page_name: string | null
        instagram_id: string | null
        instagram_username: string | null
        expires_at: Date
        last_sync_at: Date | null
        scopes: string[]
      }
    | undefined
  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    configured: metaConfigured(),
    connection: row
      ? {
          status: row.expires_at < new Date() ? 'expired' : row.status,
          pageId: row.page_id as string | null,
          pageName: row.page_name as string | null,
          instagramId: row.instagram_id as string | null,
          instagramUsername: row.instagram_username as string | null,
          expiresAt: row.expires_at.toISOString() as string,
          lastSyncAt: row.last_sync_at?.toISOString() as string | null,
          canPublishFacebook: row.scopes.includes('pages_manage_posts'),
          canPublishInstagram: row.scopes.includes('instagram_content_publish'),
        }
      : null,
  }
})
