import type { PoolClient } from 'pg'

export function isAdminApiPath(path: string) {
  return path === '/api/admin' || path.startsWith('/api/admin/')
}

export async function hasSuperadminRole(client: PoolClient, userId: string) {
  const result = await client.query(
    `SELECT 1 FROM platform_user_roles
      WHERE user_id=$1 AND role='superadmin'
      LIMIT 1`,
    [userId],
  )
  return result.rows.length > 0
}

/** The Supabase provider of the company's Microsoft (Entra ID) sign-in. */
export const ADMIN_SIGN_IN_PROVIDER = 'azure'

// The password is the one sign-in method an account may hold besides the
// company Microsoft account. Any other social account would also report
// "oauth", so its presence makes the session's origin impossible to prove.
const NON_OAUTH_PROVIDERS = new Set(['email'])

/**
 * Whether a session was opened through the company Microsoft account, which
 * carries Microsoft's own second factor. Supabase records only that the
 * session came from an OAuth provider, not which one, so the account must
 * hold the Microsoft identity and no other OAuth identity for "oauth" to
 * mean Microsoft. A password, magic link or recovery session never passes.
 */
export function signedInWithMicrosoft(signIn: { methods: string[]; providers: string[] }) {
  if (!signIn.methods.includes('oauth')) return false
  if (!signIn.providers.includes(ADMIN_SIGN_IN_PROVIDER)) return false
  return signIn.providers.every(
    provider => provider === ADMIN_SIGN_IN_PROVIDER || NON_OAUTH_PROVIDERS.has(provider),
  )
}

/**
 * The authentication methods (JWT "amr") of an access token. Read only after
 * the Auth server has accepted that same token, so the claims can be trusted.
 */
export function accessTokenMethods(accessToken: string | undefined): string[] {
  const payload = accessToken?.split('.')[1]
  if (!payload) return []
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { amr?: unknown }
    if (!Array.isArray(claims.amr)) return []
    return claims.amr
      .map(entry => (typeof entry === 'string' ? entry : (entry as { method?: unknown } | null)?.method))
      .filter((method): method is string => typeof method === 'string')
  } catch {
    return []
  }
}
