import { connectedTikTok, tiktokConfigured, tiktokDirectPostScope } from '../../utils/tiktok'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const snapshot = await withBusinessTransaction(user.id, async (client, business) => {
    // Renews the day-long access token first, so a connection whose refresh
    // token is still valid is shown as connected.
    const live = tiktokConfigured() ? await connectedTikTok(business.id, client).catch(() => null) : null
    return {
      businessId: business.id,
      token: live?.token || null,
      row: (await client.query('SELECT open_id,display_name,expires_at,status,scopes FROM tiktok_connections WHERE business_id=$1', [business.id])).rows[0],
    }
  })
  const row = snapshot.row as { open_id: string; display_name: string | null; expires_at: Date; status: string; scopes: string[] } | undefined
  let displayName = row?.display_name || null
  if (row && !displayName && snapshot.token) {
    try {
      const response = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name', {
        headers: { Authorization: `Bearer ${snapshot.token}` },
        signal: AbortSignal.timeout(8000),
      })
      const payload = await response.json() as { data?: { user?: { display_name?: string } } }
      displayName = payload.data?.user?.display_name || null
      if (displayName) {
        await withBusinessTransaction(user.id, (client, _business) =>
          client.query('UPDATE tiktok_connections SET display_name=$1,updated_at=now() WHERE business_id=$2', [displayName, snapshot.businessId]),
        )
      }
    } catch { /* The connection remains usable when TikTok profile lookup is unavailable. */ }
  }
  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    configured: tiktokConfigured(),
    connection: row
      ? {
          openId: row.open_id,
          displayName,
          status: row.status === 'connected' && !snapshot.token ? 'expired' : row.status,
          expiresAt: row.expires_at.toISOString(),
          canUpload: row.scopes.includes('video.upload'),
          canPublish: row.scopes.includes(tiktokDirectPostScope),
        }
      : null,
  }
})
