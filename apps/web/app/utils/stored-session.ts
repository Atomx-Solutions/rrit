// Supabase stores both sessions in cookies it names after the storage key.
const SESSION_COOKIE_PREFIX = 'sb-'

/**
 * Whether this browser holds any Supabase session cookie. Public pages ask
 * this first, so a visitor who never signed in does not download the Supabase
 * SDK just to learn there is no session.
 */
export function hasStoredSession() {
  return document.cookie.split('; ').some((entry) => entry.startsWith(SESSION_COOKIE_PREFIX))
}
