import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | undefined

/**
 * Returns the browser Supabase client when public credentials are configured.
 *
 * Rrit's domain reads and writes must continue through useApi(), which keeps
 * Supabase sessions and tenant authorization on the server. Use this client
 * only for Supabase products that are deliberately exposed to the browser.
 */
export function useSupabase() {
  const config = useRuntimeConfig()
  const url = config.public.supabaseUrl
  const key = config.public.supabaseKey

  if (!url || !key) return null
  return (client ||= createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  }))
}
