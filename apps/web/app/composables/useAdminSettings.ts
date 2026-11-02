export type AdminSettings = {
  ai_top_up_url: string
  ai_warn_balance_usd: number
  ai_low_balance_usd: number
  package_currency: 'CHF' | 'EUR'
  custom_package_post_price_cents: number
  custom_package_video_price_cents: number
  custom_package_credits_per_post: number
  package_request_post_options: number[]
  package_expiry_reminder_days: number
}

// One cache entry for the platform settings: every admin screen reads the same
// copy, so saving the currency on one screen updates all of them at once.
export const adminSettingsKey = 'admin-settings'

/**
 * Amounts on other admin screens are converted to the currency on the server
 * and cached under their own keys, so a currency change drops every cached
 * response and reloads the ones on screen: nothing keeps showing the old one.
 */
export async function refreshAfterCurrencyChange() {
  clearNuxtData()
  await refreshNuxtData()
}

export function useAdminSettings() {
  return useFetch<AdminSettings>('/api/admin/settings', {
    lazy: true,
    key: adminSettingsKey,
    // A screen opened later always shows what is saved now, not an older copy.
    getCachedData: () => undefined,
  })
}
