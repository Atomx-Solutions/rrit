import { timingSafeEqual } from 'node:crypto'
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
    throw createError({ statusCode: 400, message: 'Autorizimi ka skaduar. Nise lidhjen sërish.' })
  const user = await requireUser(event)
  const stored = await withUserTransaction(user.id, (client) => client.query(
    'UPDATE meta_oauth_states SET consumed_at = now() WHERE state_hash=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING business_id,return_path',
    [hashState(state), user.id],
  ))
  if (!stored.rows[0])
    throw createError({
      statusCode: 400,
      message: 'Kjo lidhje autorizimi nuk mund të përdoret përsëri.',
    })
  const { business_id: businessId, return_path: returnPath } = stored.rows[0]
  if (query.error || typeof query.code !== 'string')
    return sendRedirect(event, `${returnPath}?meta=cancelled`)
  try {
    const token = await exchangeMetaCode(query.code)
    if (
      !token.scopes.includes('pages_show_list') ||
      !token.scopes.includes('pages_read_engagement')
    )
      return sendRedirect(event, `${returnPath}?meta=permissions`)
    await withUserTransaction(user.id, async (client) => {
      await setTenantContext(client, { userId: user.id, organizationId: businessId })
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [businessId])
      const jobs = await client.query(
        "SELECT id FROM publication_jobs WHERE business_id=$1 AND status IN ('pending','processing') LIMIT 1",
        [businessId],
      )
      if (jobs.rows.length)
        throw createError({
          statusCode: 409,
          message: 'Përfundo ose anulo publikimet aktive përpara ndryshimit të lidhjes.',
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
    })
    return sendRedirect(event, `${returnPath}?meta=select`)
  } catch {
    return sendRedirect(event, `${returnPath}?meta=failed`)
  }
})
