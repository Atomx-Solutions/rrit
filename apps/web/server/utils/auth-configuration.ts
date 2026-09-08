import { createError } from 'h3'

export function authConfiguration() {
  const value = process.env.BETTER_AUTH_URL
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
  if (local) {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
      const alias = new URL(url.origin)
      alias.hostname = hostname
      origins.add(alias.origin)
    }
  }
  return {
    baseURL: url.origin,
    trustedOrigins: [...origins],
    // Temporary local shortcut. Accounts retain emailVerified=false until actually verified.
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
    /* Every capability remains unavailable when the base URL is invalid. */
  }
  const authentication = !!(
    databaseReady &&
    validUrl &&
    process.env.DATABASE_URL &&
    process.env.BETTER_AUTH_SECRET &&
    process.env.BETTER_AUTH_SECRET.length >= 32
  )
  const emailDelivery = !!(authentication && process.env.SMTP_HOST && process.env.SMTP_FROM)
  return {
    authentication,
    registration:
      authentication && trialReady && (!requireEmailVerification || emailDelivery),
    passwordRecovery: emailDelivery,
    emailDelivery,
    emailVerificationRequired: requireEmailVerification,
  }
}
