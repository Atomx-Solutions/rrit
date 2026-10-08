import { randomBytes } from 'node:crypto'
import { setTenantContext } from '../../utils/database'
import { businessForUser } from '../../utils/meta'
import { hashTikTokState, tiktokAuthorizeUrl } from '../../utils/tiktok'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const input = (await boundedBody(event, 1024)) as { onboarding?: boolean }
  const state = randomBytes(32).toString('hex')
  // Fail before persisting OAuth state when credentials or the registered callback are absent.
  const authorizationUrl = tiktokAuthorizeUrl(state)
  await withUserTransaction(user.id, async (client) => {
    const business = await businessForUser(user.id, client)
    await setTenantContext(client, { userId: user.id, organizationId: business.id })
    await client.query('INSERT INTO tiktok_oauth_states (state_hash,user_id,business_id,return_path,expires_at) VALUES ($1,$2,$3,$4,now()+interval \'10 minutes\')', [hashTikTokState(state), user.id, business.id, input.onboarding ? '/onboarding' : `/app/${business.id}/${business.slug}/social-posts`])
  })
  setCookie(event, 'rrit-tiktok-state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/api/tiktok' })
  return { url: authorizationUrl }
})
