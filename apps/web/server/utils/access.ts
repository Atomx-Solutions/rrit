import type { H3Event } from 'h3'
import { authConfiguration } from './auth-configuration'
import { supabaseServer } from './supabase'
import { accessTokenMethods } from './superadmin'

// getUser asks the Auth server to accept the session's access token, so what
// the token and the user record say can be trusted afterwards.
async function verifiedSession(event: H3Event) {
  const auth = supabaseServer(event).auth
  const { data, error } = await auth.getUser()
  if (error || !data.user || (authConfiguration().requireEmailVerification && !data.user.email_confirmed_at))
    throw createError({
      statusCode: 401,
      message: 'server.LOGIN_REQUIRED',
      data: { code: 'AUTH_REQUIRED' },
    })

  const metadata = data.user.user_metadata || {}
  const metadataName = typeof metadata.name === 'string' ? metadata.name.trim() : ''
  const user = {
    id: data.user.id,
    name: metadataName || data.user.email?.split('@')[0] || data.user.id,
    email: data.user.email || '',
    emailVerified: Boolean(data.user.email_confirmed_at),
  }
  return { auth, user, providers: (data.user.identities ?? []).map(identity => identity.provider) }
}

export async function requireUser(event: H3Event) {
  return (await verifiedSession(event)).user
}

/** The signed-in user plus how this session was opened (see signedInWithMicrosoft). */
export async function requireUserSignIn(event: H3Event) {
  const { auth, user, providers } = await verifiedSession(event)
  const { data } = await auth.getSession()
  return { user, signIn: { providers, methods: accessTokenMethods(data.session?.access_token) } }
}

// A file upload cannot be JSON; a route that takes one accepts a multipart
// form instead, still only from a trusted origin.
export function requireSameOrigin(event: H3Event, options: { multipart?: boolean } = {}) {
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
  const contentType = getHeader(event, 'content-type') || ''
  if (!contentType.startsWith('application/json') && !(options.multipart && contentType.startsWith('multipart/form-data')))
    throw createError({
      statusCode: 415,
      message: 'server.JSON_REQUEST_REQUIRED',
      data: { code: 'JSON_REQUIRED' },
    })
}
