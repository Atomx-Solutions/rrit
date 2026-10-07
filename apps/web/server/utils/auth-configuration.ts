import { createError } from 'h3'

export function authConfiguration() {
  const value = process.env.APP_URL
  if (!value)
    throw createError({ statusCode: 503, message: 'Adresa e aplikacionit nuk është konfiguruar.' })
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw createError({ statusCode: 503, message: 'Adresa e aplikacionit nuk është e vlefshme.' })
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const origins = new Set([url.origin])
  // The dev server is commonly opened through localhost even when APP_URL
  // points at a tunnel/public URL. Keep local aliases available in development
  // so same-origin mutation requests are not rejected during local testing.
  if (local || process.env.NODE_ENV !== 'production') {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
      const alias = new URL(url.origin)
      alias.hostname = hostname
      origins.add(alias.origin)
      if (!local) {
        alias.port = '3000'
        origins.add(alias.origin)
        alias.protocol = 'http:'
        origins.add(alias.origin)
      }
    }
  }
  return {
    baseURL: url.origin,
    trustedOrigins: [...origins],
    requireEmailVerification: !(local && process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === 'false'),
  }
}

export function authCapabilities(databaseReady: boolean, trialReady: boolean) {
  let requireEmailVerification = true
  let validUrl = false
  try {
    const config = authConfiguration()
    requireEmailVerification = config.requireEmailVerification
    validUrl = true
  } catch {
    /* Every capability remains unavailable when the application URL is invalid. */
  }
  const authentication = !!(
    databaseReady &&
    validUrl &&
    process.env.DATABASE_URL &&
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_KEY
  )
  const emailDelivery = authentication
  return {
    authentication,
    registration: authentication && trialReady,
    passwordRecovery: authentication,
    emailDelivery,
    emailVerificationRequired: requireEmailVerification,
  }
}
