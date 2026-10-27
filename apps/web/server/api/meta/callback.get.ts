import { timingSafeEqual } from 'node:crypto'
import { recordAuditEvent, transitionMetadata } from '../../utils/audit'
import { setTenantContext } from '../../utils/database'
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const state = typeof query.state === 'string' ? query.state : ''
  const cookie = getCookie(event, 'rrit-meta-state') || ''
  deleteCookie(event, 'rrit-meta-state', { path: '/api/meta' })
  if (
    !/^[a-f0-9]{64}$/.test(state) ||
    cookie.length !== state.length ||
    !timingSafeEqual(Buffer.from(cookie), Buffer.from(state))
  )
    throw createError({ statusCode: 400, message: 'server.AUTHORIZATION_EXPIRED' })
  const user = await requireUser(event)
  const stored = await withUserTransaction(user.id, async (client) => {
    const pending = await client.query<{ business_id: string }>(
      'SELECT business_id FROM meta_oauth_states WHERE state_hash=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at>now()',
      [hashState(state), user.id],
    )
    if (!pending.rows[0]) return null
    await setTenantContext(client, { userId: user.id, organizationId: pending.rows[0].business_id })
    return client.query<{ business_id: string; return_path: string }>(
      'UPDATE meta_oauth_states SET consumed_at = now() WHERE state_hash=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING business_id,return_path',
      [hashState(state), user.id],
    )
  })
  if (!stored?.rows[0])
    throw createError({
      statusCode: 400,
      message: 'server.AUTHORIZATION_LINK_USED',
    })
  const { business_id: businessId, return_path: returnPath } = stored.rows[0]
  async function recordAuthorizationResult(
    result: 'succeeded' | 'failed' | 'denied' | 'cancelled',
    reason?: string,
  ) {
    await withUserTransaction(user.id, async (client) => {
      await setTenantContext(client, { userId: user.id, organizationId: businessId })
      await recordAuditEvent(client, {
        actorId: user.id,
        organizationId: businessId,
        resourceType: 'meta_connection',
        resourceId: businessId,
        action: 'meta.authorization_received',
        result,
        metadata: {
          ...transitionMetadata({ oauth_status: ['pending', result] }),
          ...(reason ? { reason } : {}),
        },
      })
    })
  }
  if (query.error || typeof query.code !== 'string') {
    await recordAuthorizationResult('cancelled', 'provider_cancelled')
    return sendRedirect(event, `${returnPath}?meta=cancelled`)
  }
  try {
    const token = await exchangeMetaCode(query.code)
    if (
      !token.scopes.includes('pages_show_list') ||
      !token.scopes.includes('pages_read_engagement')
    ) {
      await recordAuthorizationResult('denied', 'required_scopes_missing')
      return sendRedirect(event, `${returnPath}?meta=permissions`)
    }
    await withUserTransaction(user.id, async (client) => {
      await setTenantContext(client, { userId: user.id, organizationId: businessId })
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [businessId])
      const jobs = await client.query(
        "SELECT id FROM publication_jobs WHERE business_id=$1 AND status IN ('pending','processing') AND target_page_id IS NOT NULL LIMIT 1",
        [businessId],
      )
      if (jobs.rows.length)
        throw createError({
          statusCode: 409,
          message: 'server.ACTIVE_PUBLICATIONS_BLOCK_RECONNECT',
        })
      await client.query(
        "DELETE FROM post_validations WHERE business_id=$1 AND COALESCE(result->>'scope','publication')='publication'",
        [businessId],
      )
      await claimSocialTrialIdentities(client, businessId, [
        { kind: 'facebook_user', value: token.userId },
      ])
      await client.query(
        "INSERT INTO meta_connections (business_id,facebook_user_id,token_ciphertext,expires_at,scopes,status) VALUES ($1,$2,$3,$4,$5,'pending') ON CONFLICT (business_id) DO UPDATE SET facebook_user_id=EXCLUDED.facebook_user_id, token_ciphertext=EXCLUDED.token_ciphertext, expires_at=EXCLUDED.expires_at, scopes=EXCLUDED.scopes, status='pending', page_id=NULL, page_name=NULL, page_token_ciphertext=NULL, instagram_id=NULL, instagram_username=NULL, updated_at=now()",
        [
          businessId,
          token.userId,
          encryptMetaToken(token.token, businessId),
          token.expiresAt,
          JSON.stringify(token.scopes),
        ],
      )
      await recordAuditEvent(client, {
        actorId: user.id,
        organizationId: businessId,
        resourceType: 'meta_connection',
        resourceId: businessId,
        action: 'meta.authorization_received',
        metadata: {
          ...transitionMetadata({
            oauth_status: ['pending', 'received'],
            connection_status: ['absent', 'pending'],
          }),
          scopeCount: token.scopes.length,
        },
      })
    })
    return sendRedirect(event, `${returnPath}?meta=select`)
  } catch {
    await recordAuthorizationResult('failed', 'exchange_or_connection_failed')
    return sendRedirect(event, `${returnPath}?meta=failed`)
  }
})
