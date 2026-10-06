import { timingSafeEqual } from 'node:crypto'
import { setTenantContext } from '../../utils/database'
import { encryptTikTokToken, exchangeTikTokCode, hashTikTokState } from '../../utils/tiktok'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const state = typeof query.state === 'string' ? query.state : ''
  const cookie = getCookie(event, 'rrit-tiktok-state') || ''
  deleteCookie(event, 'rrit-tiktok-state', { path: '/api/tiktok' })
  if (!/^[a-f0-9]{64}$/.test(state) || state.length !== cookie.length || !timingSafeEqual(Buffer.from(state), Buffer.from(cookie)))
    throw createError({ statusCode: 400, message: 'Autorizimi i TikTok ka skaduar. Nise lidhjen sërish.' })
  const user = await requireUser(event)
  const stored = await withUserTransaction(user.id, async (client) => {
    const pending = await client.query<{ business_id: string; return_path: string }>('SELECT business_id,return_path FROM tiktok_oauth_states WHERE state_hash=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at>now()', [hashTikTokState(state), user.id])
    if (!pending.rows[0]) return null
    await setTenantContext(client, { userId: user.id, organizationId: pending.rows[0].business_id })
    await client.query('UPDATE tiktok_oauth_states SET consumed_at=now() WHERE state_hash=$1', [hashTikTokState(state)])
    return pending.rows[0]
  })
  if (!stored) throw createError({ statusCode: 400, message: 'Ky autorizim nuk mund të përdoret përsëri.' })
  if (query.error || typeof query.code !== 'string') return sendRedirect(event, `${stored.return_path}?tiktok=cancelled`)
  try {
    const token = await exchangeTikTokCode(query.code)
    if (!token.scopes.includes('video.upload')) return sendRedirect(event, `${stored.return_path}?tiktok=permissions`)
    await withUserTransaction(user.id, async (client) => {
      await setTenantContext(client, { userId: user.id, organizationId: stored.business_id })
      await client.query('INSERT INTO tiktok_connections (business_id,open_id,access_token_ciphertext,refresh_token_ciphertext,expires_at,refresh_expires_at,scopes,status) VALUES ($1,$2,$3,$4,$5,$6,$7,\'connected\') ON CONFLICT (business_id) DO UPDATE SET open_id=EXCLUDED.open_id,access_token_ciphertext=EXCLUDED.access_token_ciphertext,refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,expires_at=EXCLUDED.expires_at,refresh_expires_at=EXCLUDED.refresh_expires_at,scopes=EXCLUDED.scopes,status=\'connected\',updated_at=now()', [stored.business_id, token.openId, encryptTikTokToken(token.accessToken, stored.business_id), encryptTikTokToken(token.refreshToken, stored.business_id), token.expiresAt, token.refreshExpiresAt, JSON.stringify(token.scopes)])
    })
    return sendRedirect(event, `${stored.return_path}?tiktok=connected`)
  } catch { return sendRedirect(event, `${stored.return_path}?tiktok=failed`) }
})
