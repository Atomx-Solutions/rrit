import { betterAuth } from 'better-auth'
import nodemailer from 'nodemailer'
import { authConfiguration } from './auth-configuration'

let instance: ReturnType<typeof createAuth> | undefined
export function auth() {
  return (instance ||= createAuth())
}
function createAuth() {
  const { baseURL, trustedOrigins, requireEmailVerification } = authConfiguration()
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret || secret.length < 32)
    throw createError({ statusCode: 503, message: 'Hyrja ende nuk është konfiguruar.' })
  const send = async (to: string, subject: string, text: string) => {
    if (!process.env.SMTP_HOST || !process.env.SMTP_FROM)
      throw createError({ statusCode: 503, message: 'Dërgimi i emailit nuk është konfiguruar.' })
    await nodemailer
      .createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
          : undefined,
        connectionTimeout: 10000,
        socketTimeout: 15000,
      })
      .sendMail({ from: process.env.SMTP_FROM, to, subject, text })
  }
  return betterAuth({
    appName: 'Rrit',
    baseURL,
    secret,
    database: database(),
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification,
      autoSignIn: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await send(
          user.email,
          'Rikthe qasjen në Rrit',
          `Për të vendosur një fjalëkalim të ri, hape këtë lidhje:\n\n${url}\n\nNëse nuk e kërkove ti, mund ta shpërfillësh këtë email.`,
        )
      },
    },
    emailVerification: {
      sendOnSignUp: requireEmailVerification,
      sendOnSignIn: requireEmailVerification,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await send(
          user.email,
          'Konfirmo emailin për Rrit',
          `Mirë se vjen në Rrit. Konfirmo adresën e emailit për të vazhduar me biznesin tënd:\n\n${url}\n\nNëse nuk u regjistrove ti, mund ta shpërfillësh këtë email.`,
        )
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 10 },
        '/request-password-reset': { window: 60, max: 3 },
      },
    },
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: baseURL.startsWith('https://'),
    },
  })
}
