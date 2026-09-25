import { createBrowserClient } from '@supabase/ssr'
import type { AuthError, Session } from '@supabase/supabase-js'
import { ADMIN_AUTH_STORAGE_KEY, type AuthScope } from '~~/shared/utils/auth-scope'

const clients = new Map<AuthScope, ReturnType<typeof createBrowserClient>>()

function supabase(scope: AuthScope) {
  const cached = clients.get(scope)
  if (cached) return cached
  const config = useRuntimeConfig()
  if (!config.public.supabaseUrl || !config.public.supabaseKey)
    throw new Error('SUPABASE_NOT_CONFIGURED')
  const client = createBrowserClient(config.public.supabaseUrl, config.public.supabaseKey, {
    // The library's own singleton is global and would hand both scopes the same
    // client; the cache above keeps one client per scope instead.
    isSingleton: false,
    // A cookie name of its own is what keeps the admin session from replacing
    // the customer one (and the reverse) in a browser signed in to both.
    ...(scope === 'admin' ? { cookieOptions: { name: ADMIN_AUTH_STORAGE_KEY } } : null),
    auth: {
      autoRefreshToken: true,
      // Only the customer app has email link and password reset callbacks; the
      // admin console must not consume a URL meant for the customer session.
      detectSessionInUrl: scope === 'customer',
      persistSession: true,
    },
  })
  clients.set(scope, client)
  return client
}

function callbackUrl(path?: string) {
  return path ? new URL(path, window.location.origin).toString() : undefined
}

function errorResult(error: AuthError | null) {
  return {
    error: error ? { message: error.message, code: error.code, status: error.status } : null,
  }
}

function createAuthClient(scope: AuthScope) {
  const auth = () => supabase(scope).auth

  return {
    signUp: {
      async email(input: { name: string; email: string; password: string; callbackURL?: string }) {
        const result = await auth().signUp({
          email: input.email,
          password: input.password,
          options: {
            data: { name: input.name },
            emailRedirectTo: callbackUrl(input.callbackURL),
          },
        })
        return { data: result.data, ...errorResult(result.error) }
      },
    },
    signIn: {
      async email(input: { email: string; password: string }) {
        const result = await auth().signInWithPassword(input)
        return { data: result.data, ...errorResult(result.error) }
      },
    },
    async handleCallback() {
      const url = new URL(window.location.href)
      const callbackError = url.searchParams.get('error_description') || url.searchParams.get('error')
      if (callbackError)
        return {
          data: { session: null },
          error: { message: callbackError, code: 'callback_error' },
        }

      const initialized = await auth().initialize()
      if (initialized.error) return { data: { session: null }, ...errorResult(initialized.error) }

      const result = await auth().getSession()
      return { data: result.data, ...errorResult(result.error) }
    },
    async refreshSession() {
      const result = await auth().refreshSession()
      return { data: result.data, ...errorResult(result.error) }
    },
    async signOut() {
      const result = await auth().signOut()
      return errorResult(result.error)
    },
    async requestPasswordReset(input: { email: string; redirectTo: string }) {
      const result = await auth().resetPasswordForEmail(input.email, {
        redirectTo: callbackUrl(input.redirectTo),
      })
      return errorResult(result.error)
    },
    async sendVerificationEmail(input: { email: string; callbackURL: string }) {
      const result = await auth().resend({
        type: 'signup',
        email: input.email,
        options: { emailRedirectTo: callbackUrl(input.callbackURL) },
      })
      return errorResult(result.error)
    },
    async resetPassword(input: { token?: string; newPassword: string }) {
      void input.token
      const result = await auth().updateUser({ password: input.newPassword })
      return errorResult(result.error)
    },
    async listSessions() {
      const result = await auth().getSession()
      const session: Session | null = result.data.session
      return {
        data: session
          ? [{ id: 'current', userAgent: '', createdAt: session.user.created_at }]
          : [],
        ...errorResult(result.error),
      }
    },
    async changePassword(input: {
      currentPassword: string
      newPassword: string
      revokeOtherSessions?: boolean
    }) {
      const session = await auth().getSession()
      const email = session.data.session?.user.email
      if (!email) return { error: { message: 'Sesioni nuk është aktiv.' } }
      const reauthenticated = await auth().signInWithPassword({
        email,
        password: input.currentPassword,
      })
      if (reauthenticated.error) return errorResult(reauthenticated.error)
      const result = await auth().updateUser({ password: input.newPassword })
      if (!result.error && input.revokeOtherSessions)
        await auth().signOut({ scope: 'others' })
      return errorResult(result.error)
    },
    async revokeOtherSessions() {
      const result = await auth().signOut({ scope: 'others' })
      return errorResult(result.error)
    },
  }
}

/** The customer app's session. */
export const authClient = createAuthClient('customer')

/** The admin console's session, kept in a cookie of its own. */
export const adminAuthClient = createAuthClient('admin')

export function authClientFor(scope: AuthScope) {
  return scope === 'admin' ? adminAuthClient : authClient
}
