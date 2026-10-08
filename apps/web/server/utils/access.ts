import type { H3Event } from 'h3'
import { authConfiguration } from './auth-configuration'
import { supabaseServer } from './supabase'

export async function requireUser(event: H3Event) {
  const { data, error } = await supabaseServer(event).auth.getUser()
  if (error || !data.user || (authConfiguration().requireEmailVerification && !data.user.email_confirmed_at))
    throw createError({
      statusCode: 401,
      message: 'server.LOGIN_REQUIRED',
      data: { code: 'AUTH_REQUIRED' },
    })

  const metadata = data.user.user_metadata || {}
  const metadataName = typeof metadata.name === 'string' ? metadata.name.trim() : ''
  return {
    id: data.user.id,
    name: metadataName || data.user.email?.split('@')[0] || data.user.id,
    email: data.user.email || '',
    emailVerified: Boolean(data.user.email_confirmed_at),
  }
}

export function requireSameOrigin(event: H3Event) {
  const origin = getHeader(event, 'origin')
  let localDevOrigin = false
  if (origin && process.env.NODE_ENV !== 'production') {
    try {
      const submitted = new URL(origin)
      const request = getRequestURL(event)
      localDevOrigin =
        submitted.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(submitted.hostname) &&
        submitted.origin === request.origin
    } catch {
      localDevOrigin = false
    }
  }
  if (!origin || (!authConfiguration().trustedOrigins.includes(origin) && !localDevOrigin))
    throw createError({
      statusCode: 403,
      message: 'server.REQUEST_DENIED',
      data: { code: 'ORIGIN_REJECTED' },
    })
  if (!getHeader(event, 'content-type')?.startsWith('application/json'))
    throw createError({
      statusCode: 415,
      message: 'server.JSON_REQUEST_REQUIRED',
      data: { code: 'JSON_REQUIRED' },
    })
}
