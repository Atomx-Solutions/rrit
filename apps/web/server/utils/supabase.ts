import { createServerClient } from '@supabase/ssr'
import type { H3Event } from 'h3'
import { parseCookies, setCookie } from 'h3'

export function supabaseServer(event: H3Event) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_KEY
  if (!url || !key)
    throw createError({ statusCode: 503, message: 'Supabase nuk është konfiguruar.' })

  return createServerClient(url, key, {
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
