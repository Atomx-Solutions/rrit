import { randomBytes } from 'node:crypto'
export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const config = metaConfiguration()
  const input = (await boundedBody(event, 1024)) as { onboarding?: boolean }
  const state = randomBytes(32).toString('hex')
  await withUserTransaction(user.id, async (client) => {
    const business = await businessForUser(user.id, client)
    await setTenantContext(client, { userId: user.id, organizationId: business.id })
    await client.query(
      "INSERT INTO meta_oauth_states (state_hash,user_id,business_id,return_path,expires_at) VALUES ($1,$2,$3,$4,now()+interval '10 minutes')",
      [
        hashState(state),
        user.id,
        business.id,
        input.onboarding ? '/onboarding' : `/app/${business.id}/${business.slug}/social-posts`,
      ],
    )
    return business
  })
  setCookie(event, 'rrit-meta-state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/meta',
  })
  const url = new URL(`https://www.facebook.com/${config.version}/dialog/oauth`)
  url.search = new URLSearchParams({
    client_id: config.appId,
    config_id: config.configId,
    redirect_uri: config.redirectUri,
    state,
    response_type: 'code',
    override_default_response_type: 'true',
  }).toString()
  return { url: url.toString() }
})
