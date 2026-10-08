export function useHeaderUsage() {
  return useFetch('/api/usage', { key: 'header-credit-balance', lazy: true, server: false })
}
