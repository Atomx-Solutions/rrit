export function useHeaderUsage() {
  return useFetch('/api/usage', { key: 'header-credit-balance', lazy: true, server: false })
}

/**
 * The credit balance is read in two places: the header and the billing page.
 * Both are refreshed together, so a package the team activates elsewhere shows
 * the same balance everywhere.
 */
export function refreshCreditBalance() {
  return refreshNuxtData(['header-credit-balance', 'usage'])
}
