export function usePlanCatalog() {
  const { data, error, status, refresh } = useFetch('/api/plans', { key: 'plan-catalog' })
  const plans = computed(() => data.value || [])
  return { plans, error, status, refresh }
}
