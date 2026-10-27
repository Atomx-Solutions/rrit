import { instagramConfigured, instagramPublishScope } from '../../utils/instagram'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const result = await withBusinessTransaction(user.id, async (client, business) =>
    client.query<{
      status: string
      instagram_user_id: string
      username: string | null
      expires_at: Date
      last_sync_at: Date | null
      scopes: string[]
    }>(
      'SELECT status,instagram_user_id,username,expires_at,last_sync_at,scopes FROM instagram_connections WHERE business_id=$1',
      [business.id],
    ),
  )
  const row = result.rows[0]
  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    configured: instagramConfigured(),
    connection: row
      ? {
          status: row.expires_at < new Date() ? 'expired' : row.status,
          instagramId: row.instagram_user_id,
          username: row.username,
          expiresAt: row.expires_at.toISOString(),
          lastSyncAt: row.last_sync_at?.toISOString() || null,
          canPublish: row.scopes.includes(instagramPublishScope),
        }
      : null,
  }
})
