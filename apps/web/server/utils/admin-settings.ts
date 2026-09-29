import { z } from 'zod'
import { adminServiceClient } from './admin-supabase'

export type PlatformSettings = {
  ai_top_up_url: string
  ai_warn_balance_usd: number
  ai_low_balance_usd: number
  // The rate behind every custom package price suggestion.
  custom_package_post_price_cents: number
  updated_at: string
}

export const platformSettingsChangesSchema = z.object({
  // Only https, so the button never sends an admin to an unencrypted page.
  ai_top_up_url: z.url().refine(value => value.startsWith('https://')).max(300).optional(),
  ai_warn_balance_usd: z.coerce.number().min(0).max(100_000).optional(),
  ai_low_balance_usd: z.coerce.number().min(0).max(100_000).optional(),
  custom_package_post_price_cents: z.coerce.number().int().min(1).max(1_000_000).optional(),
}).strict().refine(value => Object.keys(value).length > 0)

function normalize(value: unknown): PlatformSettings {
  const row = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    ai_top_up_url: typeof row.ai_top_up_url === 'string' ? row.ai_top_up_url : 'https://openrouter.ai/settings/credits',
    ai_warn_balance_usd: Number(row.ai_warn_balance_usd ?? 30) || 0,
    ai_low_balance_usd: Number(row.ai_low_balance_usd ?? 10) || 0,
    custom_package_post_price_cents: Number(row.custom_package_post_price_cents ?? 150) || 150,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : '',
  }
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await adminServiceClient().rpc(name, args)
  if (error) {
    console.error('Admin platform settings failed.', { name, code: error.code, message: error.message })
    const invalid = error.message?.includes('SETTINGS_INVALID')
    throw createError({
      statusCode: invalid ? 400 : 502,
      message: invalid ? 'Vlerat e cilësimeve nuk janë të vlefshme.' : 'Cilësimet e platformës nuk u ngarkuan.',
    })
  }
  return normalize(data)
}

export const platformSettings = () => rpc('admin_platform_settings', {})
export const updatePlatformSettings = (
  actor: { id: string, email?: string },
  changes: z.infer<typeof platformSettingsChangesSchema>,
) => rpc('admin_update_platform_settings', { p_actor_id: actor.id, p_actor_email: actor.email ?? '', p_changes: changes })
