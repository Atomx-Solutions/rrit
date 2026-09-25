// The admin console and the customer app are two sessions that must be able to
// coexist in one browser. Supabase keeps the session in a cookie named after
// its storage key, so signing in on one side would otherwise overwrite the
// other's cookie and silently sign that side out.
//
// The customer session keeps the default name so existing sessions survive this
// change; only the admin console moves to a name of its own.
export const ADMIN_AUTH_STORAGE_KEY = 'sb-rrit-admin-auth'

export type AuthScope = 'customer' | 'admin'

/** Which session a path belongs to: /admin/** and /api/admin/** are the console. */
export function authScopeForPath(path: string): AuthScope {
  const normalized = path.replace(/\/+$/, '') || '/'
  return normalized === '/admin'
    || normalized.startsWith('/admin/')
    || normalized === '/api/admin'
    || normalized.startsWith('/api/admin/')
    ? 'admin'
    : 'customer'
}
