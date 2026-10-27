import { timingSafeEqual } from 'node:crypto'
import { recordAuditEvent, transitionMetadata } from '../../utils/audit'
import { setTenantContext } from '../../utils/database'
import {
  encryptInstagramToken,
  exchangeInstagramCode,
  hashInstagramState,
  instagramPublishScope,
} from '../../utils/instagram'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const state = typeof query.state === 'string' ? query.state : ''
  const cookie = getCookie(event, 'rrit-instagram-state') || ''
  deleteCookie(event, 'rrit-instagram-state', { path: '/api/instagram' })
  if (
    !/^[a-f0-9]{64}$/.test(state) ||
    cookie.length !== state.length ||
    !timingSafeEqual(Buffer.from(cookie), Buffer.from(state))
  )
    throw createError({ statusCode: 400, message: 'server.AUTHORIZATION_EXPIRED' })
  const user = await requireUser(event)
  const stored = await withUserTransaction(user.id, async (client) => {
    const pending = await client.query<{ business_id: string; return_path: string }>(
      'SELECT business_id,return_path FROM instagram_oauth_states WHERE state_hash=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at>now()',
      [hashInstagramState(state), user.id],
    )
    if (!pending.rows[0]) return null
    await setTenantContext(client, { userId: user.id, organizationId: pending.rows[0].business_id })
    await client.query('UPDATE instagram_oauth_states SET consumed_at=now() WHERE state_hash=$1', [
      hashInstagramState(state),
    ])
    return pending.rows[0]
  })
  if (!stored) throw createError({ statusCode: 400, message: 'server.AUTHORIZATION_LINK_USED' })
  const { business_id: businessId, return_path: returnPath } = stored
  async function recordAuthorizationResult(
    result: 'succeeded' | 'failed' | 'denied' | 'cancelled',
    reason: string,
  ) {
    await withUserTransaction(user.id, async (client) => {
      await setTenantContext(client, { userId: user.id, organizationId: businessId })
      await recordAuditEvent(client, {
        actorId: user.id,
        organizationId: businessId,
        resourceType: 'instagram_connection',
        resourceId: businessId,
        action: 'instagram.authorization_received',
        result,
        metadata: { ...transitionMetadata({ oauth_status: ['pending', result] }), reason },
      })
    })
  }
  if (query.error || typeof query.code !== 'string') {
    await recordAuthorizationResult('cancelled', 'provider_cancelled')
    return sendRedirect(event, `${returnPath}?instagram=cancelled`)
  }
  try {
    // Instagram appends #_ to the code it returns in the redirect.
    const token = await exchangeInstagramCode(query.code.replace(/#_$/, ''))
    if (!token.scopes.includes(instagramPublishScope)) {
      await recordAuthorizationResult('denied', 'required_scopes_missing')
      return sendRedirect(event, `${returnPath}?instagram=permissions`)
    }
    await withUserTransaction(user.id, async (client) => {
      await setTenantContext(client, { userId: user.id, organizationId: businessId })
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [businessId])
      const owned = await client.query(
        'SELECT 1 FROM instagram_connections WHERE instagram_user_id=$1 AND business_id<>$2',
        [token.userId, businessId],
      )
      if (owned.rows.length)
        throw createError({ statusCode: 409, message: 'server.INSTAGRAM_ALREADY_CONNECTED' })
      await claimSocialTrialIdentities(client, businessId, [
        { kind: 'instagram_account', value: token.userId },
      ])
      await client.query(
        "DELETE FROM post_validations WHERE business_id=$1 AND COALESCE(result->>'scope','publication')='publication'",
        [businessId],
      )
      await client.query(
        "INSERT INTO instagram_connections (business_id,instagram_user_id,username,token_ciphertext,expires_at,scopes,status) VALUES ($1,$2,$3,$4,$5,$6,'connected') ON CONFLICT (business_id) DO UPDATE SET instagram_user_id=EXCLUDED.instagram_user_id,username=EXCLUDED.username,token_ciphertext=EXCLUDED.token_ciphertext,expires_at=EXCLUDED.expires_at,scopes=EXCLUDED.scopes,status='connected',updated_at=now()",
        [
          businessId,
          token.userId,
          token.username,
          encryptInstagramToken(token.token, businessId),
          token.expiresAt,
          JSON.stringify(token.scopes),
        ],
      )
      await client.query('UPDATE businesses SET revision=revision+1 WHERE id=$1', [businessId])
      await recordAuditEvent(client, {
        actorId: user.id,
        organizationId: businessId,
        resourceType: 'instagram_connection',
        resourceId: businessId,
        action: 'instagram.connected',
        metadata: {
          ...transitionMetadata({ connection_status: ['absent', 'connected'] }),
          scopeCount: token.scopes.length,
        },
      })
    })
    return sendRedirect(event, `${returnPath}?instagram=connected`)
  } catch (error) {
    const taken =
      typeof error === 'object' && error && 'message' in error &&
      error.message === 'server.INSTAGRAM_ALREADY_CONNECTED'
    await recordAuthorizationResult('failed', taken ? 'account_already_connected' : 'exchange_or_connection_failed')
    return sendRedirect(event, `${returnPath}?instagram=${taken ? 'taken' : 'failed'}`)
  }
})
