import { createServerClient } from '@supabase/ssr'
import type { H3Event } from 'h3'
import { getRequestURL, parseCookies, setCookie } from 'h3'
import { ADMIN_AUTH_STORAGE_KEY, authScopeForPath } from '../../shared/utils/auth-scope'

export function supabaseServer(event: H3Event) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_KEY
  if (!url || !key)
    throw createError({ statusCode: 503, message: 'server.SUPABASE_NOT_CONFIGURED' })

  const scope = authScopeForPath(getRequestURL(event).pathname)

  return createServerClient(url, key, {
    ...(scope === 'admin' ? { cookieOptions: { name: ADMIN_AUTH_STORAGE_KEY } } : null),
    cookies: {
      getAll() {
        return Object.entries(parseCookies(event)).map(([name, value]) => ({ name, value }))
      },
      setAll(cookies) {
        for (const { name, value, options } of cookies) setCookie(event, name, value, options)
      },
    },
  })
}
