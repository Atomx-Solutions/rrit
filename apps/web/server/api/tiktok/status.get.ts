import { tiktokConfigured } from '../../utils/tiktok'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const result = await withBusinessTransaction(user.id, (client, business) => client.query('SELECT open_id,display_name,expires_at,status,scopes FROM tiktok_connections WHERE business_id=$1', [business.id]))
  const row = result.rows[0] as { open_id: string; display_name: string | null; expires_at: Date; status: string; scopes: string[] } | undefined
  setHeader(event, 'Cache-Control', 'private, no-store')
  return { configured: tiktokConfigured(), connection: row ? { openId: row.open_id, displayName: row.display_name, status: row.expires_at < new Date() ? 'expired' : row.status, expiresAt: row.expires_at.toISOString(), canUpload: row.scopes.includes('video.upload') } : null }
})
