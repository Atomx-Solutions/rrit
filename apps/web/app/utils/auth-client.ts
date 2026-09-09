import { createBrowserClient } from '@supabase/ssr'
import type { AuthError, Session } from '@supabase/supabase-js'

let client: ReturnType<typeof createBrowserClient> | undefined

function supabase() {
  if (client) return client
  const config = useRuntimeConfig()
  if (!config.public.supabaseUrl || !config.public.supabaseKey)
    throw new Error('Supabase nuk është konfiguruar.')
  client = createBrowserClient(config.public.supabaseUrl, config.public.supabaseKey, {
    auth: { autoRefreshToken: true, detectSessionInUrl: true, persistSession: true },
  })
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

export const authClient = {
  signUp: {
    async email(input: { name: string; email: string; password: string; callbackURL?: string }) {
      const result = await supabase().auth.signUp({
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
      const result = await supabase().auth.signInWithPassword(input)
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

    const initialized = await supabase().auth.initialize()
    if (initialized.error) return { data: { session: null }, ...errorResult(initialized.error) }

    const result = await supabase().auth.getSession()
    return { data: result.data, ...errorResult(result.error) }
  },
  async signOut() {
    const result = await supabase().auth.signOut()
    return errorResult(result.error)
  },
  async requestPasswordReset(input: { email: string; redirectTo: string }) {
    const result = await supabase().auth.resetPasswordForEmail(input.email, {
      redirectTo: callbackUrl(input.redirectTo),
    })
    return errorResult(result.error)
  },
  async sendVerificationEmail(input: { email: string; callbackURL: string }) {
    const result = await supabase().auth.resend({
      type: 'signup',
      email: input.email,
      options: { emailRedirectTo: callbackUrl(input.callbackURL) },
    })
    return errorResult(result.error)
  },
  async resetPassword(input: { token?: string; newPassword: string }) {
    void input.token
    const result = await supabase().auth.updateUser({ password: input.newPassword })
    return errorResult(result.error)
  },
  async listSessions() {
    const result = await supabase().auth.getSession()
    const session: Session | null = result.data.session
    return {
      data: session
        ? [{ id: 'current', userAgent: 'Kjo pajisje', createdAt: session.user.created_at }]
        : [],
      ...errorResult(result.error),
    }
  },
  async changePassword(input: {
    currentPassword: string
    newPassword: string
    revokeOtherSessions?: boolean
  }) {
    const session = await supabase().auth.getSession()
    const email = session.data.session?.user.email
    if (!email) return { error: { message: 'Sesioni nuk është aktiv.' } }
    const reauthenticated = await supabase().auth.signInWithPassword({
      email,
      password: input.currentPassword,
    })
    if (reauthenticated.error) return errorResult(reauthenticated.error)
    const result = await supabase().auth.updateUser({ password: input.newPassword })
    if (!result.error && input.revokeOtherSessions)
      await supabase().auth.signOut({ scope: 'others' })
    return errorResult(result.error)
  },
  async revokeOtherSessions() {
    const result = await supabase().auth.signOut({ scope: 'others' })
    return errorResult(result.error)
  },
}
