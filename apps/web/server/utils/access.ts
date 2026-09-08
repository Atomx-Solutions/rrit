import type { H3Event } from 'h3'
import { authConfiguration } from './auth-configuration'

export async function requireUser(event: H3Event) {
  const session = await auth().api.getSession({ headers: event.headers })
  if (
    !session?.user ||
    (authConfiguration().requireEmailVerification && !session.user.emailVerified)
  )
    throw createError({
      statusCode: 401,
      message: 'Hyr në llogari për të vazhduar.',
      data: { code: 'AUTH_REQUIRED' },
    })
  return session.user
}
export function requireSameOrigin(event: H3Event) {
  const origin = getHeader(event, 'origin')
  if (!origin || !authConfiguration().trustedOrigins.includes(origin))
    throw createError({
      statusCode: 403,
      message: 'Kërkesa nuk u pranua.',
      data: { code: 'ORIGIN_REJECTED' },
    })
  if (!getHeader(event, 'content-type')?.startsWith('application/json'))
    throw createError({
      statusCode: 415,
      message: 'Kërkohet një kërkesë JSON.',
      data: { code: 'JSON_REQUIRED' },
    })
}
