import { safeRedirect } from '~~/shared/utils/format'

// The admin page a visitor asked for before signing in. It waits in this tab's
// session storage while Microsoft signs them in, so the callback address stays
// the one fixed URL registered with Supabase.
const NEXT_KEY = 'framic-admin-sign-in-next'

/** An admin page to continue to; anything else falls back to the overview. */
export function adminTarget(value: unknown) {
  const target = safeRedirect(value, '/admin')
  return target === '/admin' || target.startsWith('/admin/') || target.startsWith('/admin?') ? target : '/admin'
}

export function rememberAdminTarget(value: unknown) {
  try {
    sessionStorage.setItem(NEXT_KEY, adminTarget(value))
  } catch {
    // Without storage the visitor simply lands on the overview.
  }
}

export function takeAdminTarget() {
  try {
    const stored = sessionStorage.getItem(NEXT_KEY)
    sessionStorage.removeItem(NEXT_KEY)
    return adminTarget(stored)
  } catch {
    return '/admin'
  }
}
