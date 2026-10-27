import { randomBytes } from 'node:crypto'
import { recordAuditEvent, transitionMetadata } from '../../utils/audit'
import { setTenantContext } from '../../utils/database'
import { hashInstagramState, instagramAuthorizeUrl } from '../../utils/instagram'
import { businessForUser } from '../../utils/meta'

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const user = await requireUser(event)
  const input = (await boundedBody(event, 1024)) as { onboarding?: boolean }
  const state = randomBytes(32).toString('hex')
  // Fail before persisting OAuth state when credentials or the registered callback are absent.
  const authorizationUrl = instagramAuthorizeUrl(state)
  await withUserTransaction(user.id, async (client) => {
    const business = await businessForUser(user.id, client)
    await setTenantContext(client, { userId: user.id, organizationId: business.id })
    await client.query(
      "INSERT INTO instagram_oauth_states (state_hash,user_id,business_id,return_path,expires_at) VALUES ($1,$2,$3,$4,now()+interval '10 minutes')",
      [
        hashInstagramState(state),
        user.id,
        business.id,
        input.onboarding ? '/onboarding' : `/app/${business.id}/${business.slug}/social-posts`,
      ],
    )
    await recordAuditEvent(client, {
      actorId: user.id,
      organizationId: business.id,
      resourceType: 'instagram_connection',
      resourceId: business.id,
      action: 'instagram.authorization_started',
      metadata: {
        ...transitionMetadata({ oauth_status: ['absent', 'pending'] }),
        onboarding: input.onboarding === true,
      },
    })
  })
  setCookie(event, 'rrit-instagram-state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/instagram',
  })
  return { url: authorizationUrl }
})
