import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | undefined

/**
 * Platform-wide reads for the superadmin API. The service role only calls the
 * admin_* database functions; /api/admin/** is guarded by the superadmin
 * server middleware before any handler runs.
 */
export function adminServiceClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key)
    throw createError({ statusCode: 503, message: 'Qasja administrative nuk është konfiguruar.' })

  return (client ||= createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  }))
}
